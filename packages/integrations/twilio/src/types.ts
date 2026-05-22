export interface OutboundCallInput {
  toE164: string;
  fromE164: string;
  twimlUrl: string;
  statusCallbackUrl: string;
}

export interface OutboundCallResult {
  callSid: string;
  status: string;
}

export interface OutboundTwimlOptions {
  toE164: string;
  statusCallbackUrl: string;
}
