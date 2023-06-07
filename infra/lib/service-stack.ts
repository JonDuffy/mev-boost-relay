import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as rds from 'aws-cdk-lib/aws-rds';
import { RedisDB } from 'cdk-redisdb'
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ecdrD from "cdk-ecr-deployment";
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";

import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import * as path from "path";

export class ServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // core variables

    const vpcCidrBlock = "170.0.0.0/16"
    const env_name = "dev"
    const region = "eu-west-2";
    const basefqdn = `frontier-mev.io`

  

    // DNS


    const frontierZone = new route53.HostedZone(this, "CoreFrontierZone", {
      zoneName: `${env_name.toLowerCase()}-${basefqdn}`,
    });

    const sslCert = new acm.Certificate(this, "ssl_cert_for_frontier", {
      domainName: `${env_name.toLowerCase()}-${basefqdn}`,
      validation: acm.CertificateValidation.fromDns(frontierZone),
    });

    // const sslCertSsmParam = new ssm.StringParameter(this, "ssl_cert_ssm_param", {
    //   parameterName: "app_ssl_cert_arn",
    //   stringValue: sslCert.certificateArn,
    // });

    const wildcardSslCert = new acm.Certificate(this, "wildcard_ssl_cert_for_frontier", {
      domainName: `*.${env_name.toLowerCase()}-${basefqdn}`,
      validation: acm.CertificateValidation.fromDns(frontierZone),
    });

    // const wildcardSslCertSsmParam = new ssm.StringParameter(this, "wildcard_ssl_cert_ssm_param", {
    //   parameterName: "app_ssl_wildcard_cert_arn",
    //   stringValue: wildcardSslCert.certificateArn,
    // });

    new cdk.CfnOutput(this, "hosted_zone_output", {
      exportName: "hosted-zone-frontier",
      value: frontierZone.hostedZoneId,
    });

    new cdk.CfnOutput(this, "ssl_cert_output", {
      exportName: "ssl-cert-frontier",
      value: sslCert.certificateArn,
    });

    const rootFrontierZone = new route53.HostedZone(this, "CoreFrontierZoneRoot", {
      zoneName: `${env_name.toLowerCase()}.frontier.com`,
    });

    const rootSslCert = new acm.Certificate(this, "ssl_cert_for_frontier_root", {
      domainName: `${env_name.toLowerCase()}.frontier.com`,
      validation: acm.CertificateValidation.fromDns(rootFrontierZone),
    });

    // const rootSslCertSsmParam = new ssm.StringParameter(this, "ssl_cert_ssm_param_root", {
    //   parameterName: "app_ssl_cert_arn_root",
    //   stringValue: rootSslCert.certificateArn,
    // });

    const rootWildcardSslCert = new acm.Certificate(this, "wildcard_ssl_cert_for_frontier_root", {
      domainName: `*.${env_name.toLowerCase()}-app.frontier.com`,
      validation: acm.CertificateValidation.fromDns(rootFrontierZone),
    });

    // const rootWildcardSslCertSsmParam = new ssm.StringParameter(this, "wildcard_ssl_cert_ssm_param_root", {
    //   parameterName: "app_ssl_wildcard_cert_arn_root",
    //   stringValue: rootWildcardSslCert.certificateArn,
    // });

    // outputs

    new cdk.CfnOutput(this, "hosted_zone_output_root", {
      exportName: "hosted-zone-frontier-root",
      value: rootFrontierZone.hostedZoneId,
    });

    new cdk.CfnOutput(this, "ssl_cert_output_root", {
      exportName: "ssl-cert-frontier-root",
      value: rootSslCert.certificateArn,
    });
  

     // vpc
     const vpc = new ec2.Vpc(this, `frontier-task-vpc`, {
       //cidr: vpcCidrBlock,
       ipAddresses: ec2.IpAddresses.cidr(vpcCidrBlock),
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
   
    
    const mevECSCluster = new ecs.Cluster(this, "mev-boost-ECSCluster", {
			vpc: vpc,
			enableFargateCapacityProviders: true,
		});

    /**
     *  Data Layer
     */

    // a redis instance cluster

    const ecSecurityGroup = new ec2.SecurityGroup(this, 'elasticache-sg', {
      vpc: vpc,
      description: 'SecurityGroup associated with the ElastiCache Redis Cluster',
      allowAllOutbound: false,
    });
    

    const redisDB = new RedisDB(this, 'redisdb-repl-group', {
      nodes: 1,
      nodeType: 'cache.m6g.large', // recommended from the scaling docs
      nodesCpuAutoscalingTarget: 50,
      existingVpc: vpc,
      existingSecurityGroup: ecSecurityGroup,
    });
    
    // a postgres RDS cluster
    
    // TODO instance props is being deprecated, need to use readers and writers instead

    const cluster = new rds.DatabaseCluster(this, 'mev-boost-postgreess', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_15_2 }),
      credentials: rds.Credentials.fromUsername('adminuser', { password: cdk.SecretValue.unsafePlainText('7959866cacc02c2d243ecfe177464fe6') }), // TODO change this to a secret
      instanceProps: {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.X2G, ec2.InstanceSize.XLARGE),
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        vpc: vpc,
      },
      storageType: rds.DBClusterStorageType.AURORA_IOPT1,
    });


    // ecr repo for mev-boost-relay
    const mevBoostRelayRepo = new ecr.Repository(this, "mev-boost-relay-repo", {
      repositoryName: "mev-boost-relay",
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });    

    // Build containers image

    const image = new DockerImageAsset(this, "mev-boost-relay-image", {
			directory: path.join(__dirname, "../.."),
		});

    new ecdrD.ECRDeployment(this, "deploy-mev-boost-relay-Image", {
			src: new ecdrD.DockerImageName(image.imageUri),
			dest: new ecdrD.DockerImageName(
				`${mevBoostRelayRepo.repositoryUri}:latest`,
			),
		});
    
    /**
     * Services
     */
    
    /**
     * Public API services
     *  
     * */ 

    // public ECS cluster

    const publicECSCluster = new ecs.Cluster(this, "mev-boost-relay-public", {
			vpc: vpc,
			enableFargateCapacityProviders: true,
		});

    // Proposer 

    const proposerServiceTaskDef = new ecs.FargateTaskDefinition(
      this,
      "properserTaskDef",
      {
        cpu: 1024,
				memoryLimitMiB: 1024,
      }
    );

    proposerServiceTaskDef.addContainer("proposerContainer", { 
      image: ecs.ContainerImage.fromEcrRepository(mevBoostRelayRepo),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "proposer" }),
      command: ["go", "run", ".", "api", "proposer"],
      portMappings: [{ hostPort: 443, containerPort: 443 }],

     })


    // Builder API

    const builderServiceTaskDef = new ecs.FargateTaskDefinition(
      this,
      "builderTaskDef",
      {
        cpu: 1024,
				memoryLimitMiB: 1024,
      }
    );

    builderServiceTaskDef.addContainer("builderContainer", { 
      image: ecs.ContainerImage.fromEcrRepository(mevBoostRelayRepo),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "builder" }),
      command: ["go", "run", ".", "api", "builder"],
      portMappings: [{ hostPort: 443, containerPort: 443 }],
    
    
     })

    // Data API

    const dataServiceTaskDef = new ecs.FargateTaskDefinition(
      this,
      "dataTaskDef",
      {
        cpu: 1024,
				memoryLimitMiB: 1024,
      }
    );

    dataServiceTaskDef.addContainer("dataContainer", { 
      image: ecs.ContainerImage.fromEcrRepository(mevBoostRelayRepo),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "data" }),
      command: ["go", "run", ".", "api", "data"],
      portMappings: [{ hostPort: 443, containerPort: 443 }],
    
    
     })

    /**
     * Private API services
     */

     // private ECS cluster

    const privateECSCluster = new ecs.Cluster(this, "mev-boost-relay-private", {
			vpc: vpc,
			enableFargateCapacityProviders: true,
		});

    // Internal API

    const internalServiceTaskDef = new ecs.FargateTaskDefinition(
      this,
      "internalTaskDef",
      {
        cpu: 1024,
				memoryLimitMiB: 1024,
      }
    );

    internalServiceTaskDef.addContainer("internalContainer", { 
      image: ecs.ContainerImage.fromEcrRepository(mevBoostRelayRepo),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "internal" }),
      command: ["go", "run", ".", "api", "internal"],
      portMappings: [{ hostPort: 443, containerPort: 443 }],
    
     })

    // PProf API

    const pprofServiceTaskDef = new ecs.FargateTaskDefinition(
      this,
      "pprofTaskDef",
      {
        cpu: 1024,
				memoryLimitMiB: 1024,
      }
    );

    pprofServiceTaskDef.addContainer("pprofContainer", { 
      image: ecs.ContainerImage.fromEcrRepository(mevBoostRelayRepo),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "pprof" }),
      command: ["go", "run", ".", "api", "pprof"],
      portMappings: [{ hostPort: 443, containerPort: 443 }],
    
     })


    /**
    * housekeeper
    */

    const HouseKeeperServiceTaskDef = new ecs.FargateTaskDefinition(
      this,
      "HouseKeeperTaskDef",
      {
        cpu: 1024,
				memoryLimitMiB: 1024,
      }
    );

    HouseKeeperServiceTaskDef.addContainer("HousekeeperContainer", { 
      image: ecs.ContainerImage.fromEcrRepository(mevBoostRelayRepo),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "housekeeper" }),
      command: ["go", "run", ".", "api", "housekeeper"],
      portMappings: [{ hostPort: 443, containerPort: 443 }],
    
     })

    /**
     * Website
     */

    const WebsiteServiceTaskDef = new ecs.FargateTaskDefinition(
      this,
      "websiteTaskDef",
      {
        cpu: 1024,
				memoryLimitMiB: 1024,
      }
    );

    WebsiteServiceTaskDef.addContainer("WebsiteContainer", { 
      image: ecs.ContainerImage.fromEcrRepository(mevBoostRelayRepo),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "website" }),
      command: ["go", "run", ".", "api", "website"],
      portMappings: [{ hostPort: 443, containerPort: 443 }],
    
     })

     /**
      * Security Groups
      * 
      */

     // proposer security group
     
     const proposerServiceSecurityGroup = new ec2.SecurityGroup(
			this,
			"ProposerServiceSecurityGroup",
			{
				securityGroupName: `ProposerService`,
				vpc: vpc,
			},
		);

     // website security group

     const websiteServiceSecurityGroup = new ec2.SecurityGroup(
			this,
			"websiteServiceSecurityGroup",
			{
				securityGroupName: `WebsiteService`,
				vpc: vpc,
			},
		);
    
    websiteServiceSecurityGroup.connections.allowFromAnyIpv4(ec2.Port.tcp(443), "allow https access from anywhere")


     // housekeeper security group

     const housekeeperServiceSecurityGroup = new ec2.SecurityGroup(
			this,
			"housekeeperServiceSecurityGroup",
			{
				securityGroupName: `HousekeeperService`,
				vpc: vpc,
			},
		);

     // internal security group

     // pprof security group
     
     // data security group

     // internal security group

    // builder security group


     /**
      * Fargate Services
      * 
      */

     // FQDNs
    const housekeeperapiFQDN = `housekeeper-api.${frontierZone.zoneName}`
    const internalapiFQDN = `internal-api.${frontierZone.zoneName}`
    const pprofapiFQDN = `pprof-api.${frontierZone.zoneName}`
    const dataapiFQDN = `data-api.${frontierZone.zoneName}`
    const builderapiFQDN = `builder-api.${frontierZone.zoneName}`
    const proposerapiFQDN = `proposer-api.${frontierZone.zoneName}`
    const websiteFQDN = `website.${frontierZone.zoneName}`


     const websiteFargateService =
        new ApplicationLoadBalancedFargateService(this, "WebsiteService", {
          cluster: publicECSCluster,
          memoryLimitMiB: 1024,
          desiredCount: 1,
          cpu: 512,
          certificate: wildcardSslCert,
          taskDefinition: WebsiteServiceTaskDef,
          domainName: websiteFQDN,
          domainZone: frontierZone,
          securityGroups: [websiteServiceSecurityGroup],
      
        });

    const ProposerFargateService =
        new  ApplicationLoadBalancedFargateService(this, "ProposerService", {
          cluster: publicECSCluster,
          memoryLimitMiB: 1024,
          desiredCount: 2,
          cpu: 1024,
          certificate: wildcardSslCert,
          taskDefinition: proposerServiceTaskDef,
          domainName: proposerapiFQDN,
          domainZone: frontierZone,
          securityGroups: [proposerServiceSecurityGroup],
      
        });

  } 
}
