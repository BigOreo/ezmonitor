/**
 * Signaling protocol exchanged over the WebSocket connection between a
 * child app and the parent app it is paired with. This is a thin relay:
 * the actual screen video travels peer-to-peer over WebRTC once the
 * offer/answer/ICE exchange below has completed.
 */

export interface JoinAck {
  type: "join-ack";
  accepted: boolean;
  parentName: string;
  reason?: string;
}

/** Parent asks a specific child device to start streaming its screen. */
export interface ViewRequest {
  type: "view-request";
}

/**
 * Child's acknowledgement that it is starting to stream in response to a
 * ViewRequest. On a parent-owned/managed device this is sent automatically
 * (no interactive prompt) — it exists in the protocol mainly so the parent
 * app knows a stream is coming and can distinguish "starting" from "the
 * device is offline / can't capture its screen".
 */
export interface ConsentResponse {
  type: "consent-response";
  granted: boolean;
  reason?: string;
}

export interface SdpOffer {
  type: "offer";
  sdp: string;
}

export interface SdpAnswer {
  type: "answer";
  sdp: string;
}

export interface IceCandidateMessage {
  type: "ice-candidate";
  candidate: RTCIceCandidateInit;
}

/** Parent tells the child device to stop sharing/streaming. */
export interface StopViewing {
  type: "stop-viewing";
}

/**
 * Parent has revoked this device's pairing — e.g. it reset the family code
 * because it may have leaked. Sent to currently-connected child devices
 * right before disconnecting them; a device that is offline at the time
 * instead gets this as the `reason` on a rejected JoinAck the next time it
 * tries to reconnect with its now-invalid stored code.
 */
export interface KickedMessage {
  type: "kicked";
  reason?: string;
}

export type SignalingMessage =
  | JoinAck
  | ViewRequest
  | ConsentResponse
  | SdpOffer
  | SdpAnswer
  | IceCandidateMessage
  | StopViewing
  | KickedMessage;

export interface ChildInfo {
  id: string;
  name: string;
}
