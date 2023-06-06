import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as rds from 'aws-cdk-lib/aws-rds';
import { RedisDB } from 'cdk-redisdb'
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecdrD from "cdk-ecr-deployment";
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import * as path from "path";

import { NetworkStack } from './networking-stack';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class TaskStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);


    // lookup existing VPC 
    // TODO needs to be deployed first 

    const coreVpc = ec2.Vpc.fromLookup(this, "coreVpc", {
			isDefault: false,
			vpcName: `frontier-task-vpc`,
		});
    
    const mevECSCluster = new ecs.Cluster(this, "mev-boost-ECSCluster", {
			vpc: coreVpc,
			enableFargateCapacityProviders: true,
		});

    // ecr repo for mev-boost-relay
    const mevBoostRelayRepo = new ecr.Repository(this, "mev-boost-relay-repo", {
      repositoryName: "mev-boost-relay",
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });    

    // Build containers images

    const image = new DockerImageAsset(this, "mev-boost-relay-image", {
			directory: path.join(__dirname, "../../app"),
		});

    new ecdrD.ECRDeployment(this, "deploy-mev-boost-relay-Image", {
			src: new ecdrD.DockerImageName(image.imageUri),
			dest: new ecdrD.DockerImageName(
				`${mevBoostRelayRepo.repositoryUri}:latest`,
			),
		});

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
      nodeType: 'cache.m6g.large', // recommended from the scaling docs
      nodesCpuAutoscalingTarget: 50,
      existingVpc: coreVpc,
      existingSecurityGroup: ecSecurityGroup,
    });


    // instance configuration, building an AMI with the required servives installed

    // 

  }
}
