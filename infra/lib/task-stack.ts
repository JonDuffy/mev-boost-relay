import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as rds from 'aws-cdk-lib/aws-rds';
import { RedisDB } from 'cdk-redisdb'
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';

import { NetworkStack } from './networking-stack';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class TaskStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);


    // lookup existing VPC 
    // TODO needs to be deployed first 

    const coreVpc = ec2.Vpc.fromLookup(this, "coreVpc", {
			isDefault: false,
			vpcName: `core-internet-${env_name}`,
		});
    
    


    // Build containers images



    // A Postgres RDS DB 
    

    // a redis elasticache cluster
   

    // import existing VPC 


    const ecSecurityGroup = new ec2.SecurityGroup(this, 'elasticache-sg', {
      vpc: coreVpc,
      description: 'SecurityGroup associated with the ElastiCache Redis Cluster',
      allowAllOutbound: false,
    });

    new RedisDB(this, 'redisdb-repl-group', {
      nodes: 1,
      nodeType: 'cache.m6g.large', // recommended for this application
      nodesCpuAutoscalingTarget: 50,
      existingVpc: coreVpc,
      existingSecurityGroup: ecSecurityGroup,
    });


    // instance configuration, building an AMI with the required servives installed

    // 

  }
}
