#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import {InspectorAssessmentTemplateStack} from '../lib/inspector-assessment-template/amazon-inspector-assessment-template-stack';
import {FirehoseStack} from '../lib/firehose-glue-athena/firehose-glue-stack';
import {InspectorSnsTopicStack} from '../lib/setup-sns-topics/inspector-sns-topic-stack';

const app = new cdk.App();

// Create SNS Topics
new InspectorSnsTopicStack(app, 'sns-topics-stack', {})

// Create Firehose, OpenSearch
new FirehoseStack(app, 'firehose-glue-stack', {})

// Create Inspector Assessment Template
new InspectorAssessmentTemplateStack(app, 'assessment-template-stack', {})


