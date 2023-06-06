import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class NetworkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, vpcCidrBlock: string, envName: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //const projectName = "";
    const region = "eu-west-2";

    // vpc
    const vpc = new ec2.Vpc(this, `frontier-task-vpc`, {
      cidr: vpcCidrBlock,
      maxAzs: 2,
      subnetConfiguration: [
        {
          subnetType: ec2.SubnetType.PUBLIC,
          name: 'Public Facing',
          cidrMask: 24,
        },
        {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          name: 'Application',
          cidrMask: 19,
        },
        {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          name: 'Data',
          cidrMask: 19,
        },
        {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          name: 'Endpoint',
          cidrMask: 19,
        }
      ]
    });

    new cdk.CfnOutput(this, "VpcID", {
      value: vpc.vpcId,
    });
  }
}
