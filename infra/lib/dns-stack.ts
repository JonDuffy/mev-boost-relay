import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export class CoreServicesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, env_name: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const myHostedZone = new route53.HostedZone(this, "CoreFrontierZone", {
      zoneName: `${env_name.toLowerCase()}-app.frontier.com`,
    });

    const sslCert = new acm.Certificate(this, "ssl_cert_for_frontier", {
      domainName: `${env_name.toLowerCase()}-app.frontier.com`,
      validation: acm.CertificateValidation.fromDns(myHostedZone),
    });

    const sslCertSsmParam = new ssm.StringParameter(this, "ssl_cert_ssm_param", {
      parameterName: "app_ssl_cert_arn",
      stringValue: sslCert.certificateArn,
    });

    const wildcardSslCert = new acm.Certificate(this, "wildcard_ssl_cert_for_frontier", {
      domainName: `*.${env_name.toLowerCase()}-app.frontier.com`,
      validation: acm.CertificateValidation.fromDns(myHostedZone),
    });

    const wildcardSslCertSsmParam = new ssm.StringParameter(this, "wildcard_ssl_cert_ssm_param", {
      parameterName: "app_ssl_wildcard_cert_arn",
      stringValue: wildcardSslCert.certificateArn,
    });

    new cdk.CfnOutput(this, "hosted_zone_output", {
      exportName: "hosted-zone-frontier",
      value: myHostedZone.hostedZoneId,
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

    const rootSslCertSsmParam = new ssm.StringParameter(this, "ssl_cert_ssm_param_root", {
      parameterName: "app_ssl_cert_arn_root",
      stringValue: rootSslCert.certificateArn,
    });

    const rootWildcardSslCert = new acm.Certificate(this, "wildcard_ssl_cert_for_frontier_root", {
      domainName: `*.${env_name.toLowerCase()}-app.frontier.com`,
      validation: acm.CertificateValidation.fromDns(rootFrontierZone),
    });

    const rootWildcardSslCertSsmParam = new ssm.StringParameter(this, "wildcard_ssl_cert_ssm_param_root", {
      parameterName: "app_ssl_wildcard_cert_arn_root",
      stringValue: rootWildcardSslCert.certificateArn,
    });

    new cdk.CfnOutput(this, "hosted_zone_output_root", {
      exportName: "hosted-zone-frontier-root",
      value: rootFrontierZone.hostedZoneId,
    });

    new cdk.CfnOutput(this, "ssl_cert_output_root", {
      exportName: "ssl-cert-frontier-root",
      value: rootSslCert.certificateArn,
    });
  }
}
