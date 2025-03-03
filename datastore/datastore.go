// Package datastore helps storing data, utilizing Redis and Postgres as backends
package datastore

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/attestantio/go-builder-client/api"
	consensusspec "github.com/attestantio/go-eth2-client/spec"
	"github.com/attestantio/go-eth2-client/spec/capella"
	"github.com/bradfitz/gomemcache/memcache"
	"github.com/flashbots/go-boost-utils/types"
	"github.com/flashbots/mev-boost-relay/beaconclient"
	"github.com/flashbots/mev-boost-relay/common"
	"github.com/flashbots/mev-boost-relay/database"
	"github.com/go-redis/redis/v9"
	"github.com/pkg/errors"
	"github.com/sirupsen/logrus"
	uberatomic "go.uber.org/atomic"
)

var ErrExecutionPayloadNotFound = errors.New("execution payload not found")

type GetHeaderResponseKey struct {
	Slot           uint64
	ParentHash     string
	ProposerPubkey string
}

type GetPayloadResponseKey struct {
	Slot           uint64
	ProposerPubkey string
	BlockHash      string
}

// Datastore provides a local memory cache with a Redis and DB backend
type Datastore struct {
	log *logrus.Entry

	redis     *RedisCache
	memcached *Memcached
	db        database.IDatabaseService

	knownValidatorsByPubkey   map[types.PubkeyHex]uint64
	knownValidatorsByIndex    map[uint64]types.PubkeyHex
	knownValidatorsLock       sync.RWMutex
	knownValidatorsIsUpdating uberatomic.Bool
	knownValidatorsLastSlot   uberatomic.Uint64
}

func NewDatastore(log *logrus.Entry, redisCache *RedisCache, memcached *Memcached, db database.IDatabaseService) (ds *Datastore, err error) {
	ds = &Datastore{
		log:                     log.WithField("component", "datastore"),
		db:                      db,
		memcached:               memcached,
		redis:                   redisCache,
		knownValidatorsByPubkey: make(map[types.PubkeyHex]uint64),
		knownValidatorsByIndex:  make(map[uint64]types.PubkeyHex),
	}

	return ds, err
}

// RefreshKnownValidators loads known validators from CL client into memory
//
// For the CL client this is an expensive operation and takes a bunch of resources.
// This is why we schedule the requests for slot 4 and 20 of every epoch, 6 seconds
// into the slot (on suggestion of @potuz). It's also run once at startup.
func (ds *Datastore) RefreshKnownValidators(beaconClient beaconclient.IMultiBeaconClient, slot uint64) {
	// Ensure there's only one at a time
	if isAlreadyUpdating := ds.knownValidatorsIsUpdating.Swap(true); isAlreadyUpdating {
		return
	}
	defer ds.knownValidatorsIsUpdating.Store(false)

	headSlotPos := common.SlotPos(slot) // 1-based position in epoch (32 slots, 1..32)
	lastUpdateSlot := ds.knownValidatorsLastSlot.Load()
	log := ds.log.WithFields(logrus.Fields{
		"method":         "RefreshKnownValidators",
		"headSlot":       slot,
		"headSlotPos":    headSlotPos,
		"lastUpdateSlot": lastUpdateSlot,
	})

	// Only proceed if slot newer than last updated
	if slot <= lastUpdateSlot {
		return
	}

	// 	// Minimum amount of slots between updates
	slotsSinceLastUpdate := slot - lastUpdateSlot
	if slotsSinceLastUpdate < 6 {
		return
	}

	log.Debug("RefreshKnownValidators init")

	// Proceed only if forced, or on slot-position 4 or 20
	forceUpdate := slotsSinceLastUpdate > 32
	if !forceUpdate && headSlotPos != 4 && headSlotPos != 20 {
		return
	}

	// Wait for 6s into the slot
	if lastUpdateSlot > 0 {
		time.Sleep(6 * time.Second)
	}

	log.Info("Querying validators from beacon node... (this may take a while)")
	timeStartFetching := time.Now()
	validators, err := beaconClient.GetStateValidators(beaconclient.StateIDHead) // head is fastest
	if err != nil {
		log.WithError(err).Error("failed to fetch validators from all beacon nodes")
		return
	}

	numValidators := len(validators.Data)
	log = log.WithFields(logrus.Fields{
		"numKnownValidators":        numValidators,
		"durationFetchValidatorsMs": time.Since(timeStartFetching).Milliseconds(),
	})
	log.Infof("received known validators from beacon-node")

	err = ds.redis.SetStats(RedisStatsFieldValidatorsTotal, fmt.Sprint(numValidators))
	if err != nil {
		log.WithError(err).Error("failed to set stats for RedisStatsFieldValidatorsTotal")
	}

	// At this point, consider the update successful
	ds.knownValidatorsLastSlot.Store(slot)

	knownValidatorsByPubkey := make(map[types.PubkeyHex]uint64)
	knownValidatorsByIndex := make(map[uint64]types.PubkeyHex)

	for _, valEntry := range validators.Data {
		pk := types.NewPubkeyHex(valEntry.Validator.Pubkey)
		knownValidatorsByPubkey[pk] = valEntry.Index
		knownValidatorsByIndex[valEntry.Index] = pk
	}

	ds.knownValidatorsLock.Lock()
	ds.knownValidatorsByPubkey = knownValidatorsByPubkey
	ds.knownValidatorsByIndex = knownValidatorsByIndex
	ds.knownValidatorsLock.Unlock()

	log.Infof("known validators updated")
}

func (ds *Datastore) IsKnownValidator(pubkeyHex types.PubkeyHex) bool {
	ds.knownValidatorsLock.RLock()
	defer ds.knownValidatorsLock.RUnlock()
	_, found := ds.knownValidatorsByPubkey[pubkeyHex]
	return found
}

func (ds *Datastore) GetKnownValidatorPubkeyByIndex(index uint64) (types.PubkeyHex, bool) {
	ds.knownValidatorsLock.RLock()
	defer ds.knownValidatorsLock.RUnlock()
	pk, found := ds.knownValidatorsByIndex[index]
	return pk, found
}

func (ds *Datastore) NumKnownValidators() int {
	ds.knownValidatorsLock.RLock()
	defer ds.knownValidatorsLock.RUnlock()
	return len(ds.knownValidatorsByIndex)
}

func (ds *Datastore) NumRegisteredValidators() (uint64, error) {
	return ds.db.NumRegisteredValidators()
}

// SaveValidatorRegistration saves a validator registration into both Redis and the database
func (ds *Datastore) SaveValidatorRegistration(entry types.SignedValidatorRegistration) error {
	// First save in the database
	err := ds.db.SaveValidatorRegistration(database.SignedValidatorRegistrationToEntry(entry))
	if err != nil {
		return errors.Wrap(err, "failed saving validator registration to database")
	}

	// then save in redis
	pk := types.NewPubkeyHex(entry.Message.Pubkey.String())
	err = ds.redis.SetValidatorRegistrationTimestampIfNewer(pk, entry.Message.Timestamp)
	if err != nil {
		return errors.Wrap(err, "failed saving validator registration to redis")
	}

	return nil
}

// GetGetPayloadResponse returns the getPayload response from memory or Redis or Database
func (ds *Datastore) GetGetPayloadResponse(slot uint64, proposerPubkey, blockHash string) (*common.VersionedExecutionPayload, error) {
	_proposerPubkey := strings.ToLower(proposerPubkey)
	_blockHash := strings.ToLower(blockHash)

	// 1. try to get from Redis
	resp, err := ds.redis.GetExecutionPayloadCapella(slot, _proposerPubkey, _blockHash)
	if errors.Is(err, redis.Nil) {
		ds.log.WithError(err).Warn("execution payload not found in redis")
	} else if err != nil {
		ds.log.WithError(err).Error("error getting execution payload from redis")
	} else {
		ds.log.Debug("getPayload response from redis")
		return resp, nil
	}

	// 2. try to get from Memcached
	if ds.memcached != nil {
		resp, err = ds.memcached.GetExecutionPayload(slot, _proposerPubkey, _blockHash)
		if errors.Is(err, memcache.ErrCacheMiss) {
			ds.log.WithError(err).Warn("execution payload not found in memcached")
		} else if err != nil {
			ds.log.WithError(err).Error("error getting execution payload from memcached")
		} else if resp != nil {
			ds.log.Debug("getPayload response from memcached")
			return resp, nil
		}
	}

	// 3. try to get from database (should not happen, it's just a backup)
	executionPayloadEntry, err := ds.db.GetExecutionPayloadEntryBySlotPkHash(slot, proposerPubkey, blockHash)
	if errors.Is(err, sql.ErrNoRows) {
		ds.log.WithError(err).Warn("execution payload not found in database")
		return nil, ErrExecutionPayloadNotFound
	} else if err != nil {
		ds.log.WithError(err).Error("error getting execution payload from database")
		return nil, err
	}

	// Got it from databaase, now deserialize execution payload and compile full response
	ds.log.Warn("getPayload response from database, primary storage failed")
	var res consensusspec.DataVersion
	err = json.Unmarshal([]byte(executionPayloadEntry.Version), &res)
	if err != nil {
		ds.log.Debug("invalid getPayload version from database")
		return nil, err
	}
	switch res {
	case consensusspec.DataVersionCapella:
		executionPayload := new(capella.ExecutionPayload)
		err = json.Unmarshal([]byte(executionPayloadEntry.Payload), executionPayload)
		if err != nil {
			return nil, err
		}
		capella := api.VersionedExecutionPayload{
			Version:   res,
			Capella:   executionPayload,
			Bellatrix: nil,
		}
		return &common.VersionedExecutionPayload{
			Capella:   &capella,
			Bellatrix: nil,
		}, nil
	case consensusspec.DataVersionBellatrix:
		executionPayload := new(types.ExecutionPayload)
		err = json.Unmarshal([]byte(executionPayloadEntry.Payload), executionPayload)
		if err != nil {
			return nil, err
		}
		bellatrix := types.GetPayloadResponse{
			Version: types.VersionString(res.String()),
			Data:    executionPayload,
		}
		return &common.VersionedExecutionPayload{
			Bellatrix: &bellatrix,
			Capella:   nil,
		}, nil
	case consensusspec.DataVersionDeneb:
		return nil, errors.New("todo")
	case consensusspec.DataVersionAltair, consensusspec.DataVersionPhase0:
		return nil, errors.New("unsupported execution payload version")
	default:
		return nil, errors.New("unknown execution payload version")
	}
}
