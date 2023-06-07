#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DNSStack } from '../lib/dns-stack';
import { NetworkStack } from '../lib/network-stack';
import { ServiceStack } from '../lib/service-stack';

const app = new cdk.App();



new ServiceStack(app, 'TaskStack', {

  env: { account: '*********', region: 'eu-west-2' } 
});
