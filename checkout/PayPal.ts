import {
  ClientIDSecretCredentials,
  ParsedAuthorizationResponse,
  ParsedCaptureResponse,
  PayPalOrder,
  ProcessorConnection,
  RawAuthorizationRequest,
  RawCancelRequest,
  RawCaptureRequest,
} from '@primer-io/app-framework';

/**
 * Use the HTTP Client to make requests to PayPal's orders API
 */
import HTTPClient from '../common/HTTPClient';


// PayPal API
const PAYPAL_ORDER_API = 'https://api-m.sandbox.paypal.com/v2/checkout/orders/';

const PayPalConnection: ProcessorConnection<
  ClientIDSecretCredentials,
  PayPalOrder
> = {
  name: 'PAYPAL',

  website: 'https://paypal.com',

  configuration: {
    // TODO: encrypt or save in env-vars
    accountId: 'sb-2a1oc4965682@business.example.com',
    clientId: 'AbY73rnq8KzdTJ3YasQVKkD0K2QUqb_76Lz8RIMVKjdkIxUcNXmIQbJ9hciY0bQ6xO2eFKMJiKvoMz2a',
    clientSecret: 'EN5v_LZwvQodv1wUEpLH49BOZYZjDt84ef0JoUmdfnfMuuRV31p_CH6IqupzzrMsj0KFiqREmOoHHnJ_',
  },

  /**
   * Authorize a PayPal order
   * Use the HTTPClient and the request info to authorize a paypal order
   */
  authorize(
    request: RawAuthorizationRequest<ClientIDSecretCredentials, PayPalOrder>,
  ): Promise<ParsedAuthorizationResponse> {
    const url = PAYPAL_ORDER_API + request.paymentMethod.orderId + "/authorize";
    const authString = `${ request.processorConfig.clientId }:${ request.processorConfig.clientSecret }`;
    const basicAuth = Buffer.from(authString).toString("base64");

    return HTTPClient.request(url, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + basicAuth
      },
      body: ''
    }).then((response) => {
      let result: ParsedAuthorizationResponse
      const responseContent = JSON.parse(response.responseText)
      switch (response.statusCode){
        case 201:
          const authorization = responseContent.purchase_units[0].payments.authorizations[0];
          switch(responseContent.status){
            // The order was created with the specified context.
            case 'CREATED':
            // The order was saved and persisted. The order status continues to be in progress until a capture is made with final_capture = true for all purchase units within the order.
            case 'SAVED':
              result = {
                transactionStatus: 'SETTLING',
                processorTransactionId: authorization.id
              }
              break
            // The customer approved the payment through the PayPal wallet or another form of guest or unbranded payment. For example, a card, bank account, or so on.
            case 'APPROVED':
              result = {
                transactionStatus: 'AUTHORIZED',
                processorTransactionId: authorization.id
              }
              break
            // All purchase units in the order are voided.
            case 'VOIDED':
              result = {
                transactionStatus: 'CANCELLED',
                processorTransactionId: authorization.id
              }
              break
            // The payment was authorized or the authorized payment was captured for the order.
            case 'COMPLETED':
              switch(authorization.status){
                // The authorized payment is created. No captured payments have been made for this authorized payment.
                case 'CREATED':
                  result = {
                    transactionStatus: 'AUTHORIZED',
                    processorTransactionId: authorization.id
                  }
                  break
                // The authorized payment has one or more captures against it. The sum of these captured payments is greater than the amount of the original authorized payment.
                // TODO?
                case 'CAPTURED':
                  result = {
                    transactionStatus: 'FAILED',
                    errorMessage: 'The authorized payment has one or more captures against it'
                  }
                  break
                // PayPal cannot authorize funds for this authorized payment.
                case 'DENIED':
                  result = {
                    transactionStatus: 'DECLINED',
                    declineReason: 'PayPal cannot authorize funds for this authorized payment'
                  }
                  break
                // The authorized payment has expired.
                case 'EXPIRED':
                  result = {
                    transactionStatus: 'FAILED',
                    errorMessage: 'The authorized payment has expired'
                  }
                  break
                // A captured payment was made for the authorized payment for an amount that is less than the amount of the original authorized payment.
                case 'PARTIALLY_CAPTURED':
                // The payment which was authorized for an amount that is less than the originally requested amount.
                case 'PARTIALLY_CREATED':
                // The created authorization is in pending state.
                case 'PENDING':
                  result = {
                    transactionStatus: 'SETTLING',
                    processorTransactionId: authorization.id
                  }
                  break
                // The authorized payment was voided. No more captured payments can be made against this authorized payment.
                case 'VOIDED':
                  result = {
                    transactionStatus: 'CANCELLED',
                    processorTransactionId: authorization.id
                  }
                  break
                default:
                  result = {
                    transactionStatus: 'FAILED',
                    errorMessage: "Unknown authorization status " + authorization.status
                  }
              }
              break
            // The order requires an action from the payer (e.g. 3DS authentication). Redirect the payer to the "rel":"payer-action" HATEOAS link returned as part of the response prior to authorizing or capturing the order.
            case 'PAYER_ACTION_REQUIRED':
              result = {
                transactionStatus: 'SETTLING',
                processorTransactionId: authorization.id
              }
              break
            default:
              result = {
                transactionStatus: 'FAILED',
                errorMessage: 'Unknown order status: ' + responseContent.status
              }
          }
          break
        case 401:
          result = {
            transactionStatus: 'FAILED',
            errorMessage: 'Unauthorized',
          }
          break;
        case 422:
          result = {
            transactionStatus: 'DECLINED',
            declineReason: 'Order already authorized, one authorization per order is allowed.',
          }
          break
        default:
          result = {
            transactionStatus: 'FAILED',
            errorMessage: 'ResponseCode' + response.statusCode + ' not recognized',
          }
      }
      return result
    })
  },

  /**
   * Cancel a PayPal order
   * Use the HTTPClient and the request information to cancel the PayPal order
   * To cancell an authorized payment: https://developer.paypal.com/docs/api/payments/v2/#authorizations_void
   */
  cancel(
    request: RawCancelRequest<ClientIDSecretCredentials>,
  ): Promise<ParsedCaptureResponse> {
    const url = 'https://api-m.sandbox.paypal.com/v2/payments/authorizations/'+ request.processorTransactionId + '/void'

    const authString = `${ request.processorConfig.clientId }:${ request.processorConfig.clientSecret }`;
    const basicAuth = Buffer.from(authString).toString("base64");
    return HTTPClient.request(url, {
      method: 'post',
      headers:{
        'Content-Type' : 'application/json',
        'Authorization' : 'Basic ' + basicAuth
      },
      body: ''
    }).then((response) =>{
      let result: ParsedAuthorizationResponse
      switch(response.statusCode){
        // Successfully cancelled
        case 204:
          result = {
            transactionStatus: 'CANCELLED',
            processorTransactionId: request.processorTransactionId
          }
          break
        // Unauthorized
        case 401:
          result = {
            transactionStatus: 'FAILED',
            errorMessage: 'Unauthorized'
          }
          break
        // Already cancelled
        case 422:
          result = {
            transactionStatus: 'FAILED',
            errorMessage: 'Authorization has been previously voided and hence cannot be voided again'
          }
          break
        default:
          result = {
            transactionStatus: 'FAILED',
            errorMessage: 'Unknown problem when trying to cancel the transaction order'
          }
      }
      return result
    })
  },

  /**
   * Capture a PayPal order (You can ignore this method for the exercise)
   */
  capture(
    request: RawCaptureRequest<ClientIDSecretCredentials>,
  ): Promise<ParsedCaptureResponse> {
    throw new Error('Not Implemented');
  },
};

export default PayPalConnection;
