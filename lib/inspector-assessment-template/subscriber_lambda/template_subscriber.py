import cfnresponse
import boto3
import logging as log

def lambda_handler(event, context):

    log.getLogger().setLevel(log.INFO)
    try:
        log.info('Input event: %s', event)

        if event['RequestType'] == 'Create' and event['ResourceProperties'].get('FailCreate', False):
            raise RuntimeError('Create failure requested')
        template_arn = event['ResourceProperties']['Template']
        topic_arn = event['ResourceProperties']['Topic']
        inspector_client = boto3.client('inspector')
        log.info("Subscribing Template %s to Topic %s", template_arn, topic_arn)

        inspector_client.subscribe_to_event(
            resourceArn=template_arn,
            event="FINDING_REPORTED",
            topicArn=topic_arn
        )
        cfnresponse.send(event, context, cfnresponse.SUCCESS,
                         {'Response': 'Template was subscribed to Topic'}, 'InspectorSNSSubscriber')
    except Exception as e:
        log.exception(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, {}, 'InspectorSNSSubscriber')