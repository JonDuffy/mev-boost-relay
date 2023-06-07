#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DNSStack } from '../lib/dns-stack';
import { NetworkStack } from '../lib/network-stack';
import { ServiceStack } from '../lib/service-stack';

const app = new cdk.App();

// new DNSStack(app, 'DNSStack', 'dev', {
//   env: { account: '106225348621', region: 'eu-west-2' }

// });

// new NetworkStack(app, 'NetworkStack', "170.0.0.0/16", 'dev', {
//   env: { account: '106225348621', region: 'eu-west-2' },
  
// });

new ServiceStack(app, 'TaskStack', {

  env: { account: '106225348621', region: 'eu-west-2' } 
});
