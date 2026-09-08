/**
 * Signaling protocol exchanged over the WebSocket connection between a
 * student app and the teacher app that it has joined. This is a thin
 * relay: the actual screen video travels peer-to-peer over WebRTC once
 * the offer/answer/ICE exchange below has completed.
 */

export interface JoinAck {
  type: "join-ack";
  accepted: boolean;
  teacherName: string;
  reason?: string;
}

/** Teacher asks a specific student for permission to start viewing. */
export interface ViewRequest {
  type: "view-request";
}

/** Student's answer to a ViewRequest. */
export interface ConsentResponse {
  type: "consent-response";
  granted: boolean;
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

/** Teacher tells the student to stop sharing/streaming. */
export interface StopViewing {
  type: "stop-viewing";
}

export type SignalingMessage =
  | JoinAck
  | ViewRequest
  | ConsentResponse
  | SdpOffer
  | SdpAnswer
  | IceCandidateMessage
  | StopViewing;

export interface StudentInfo {
  id: string;
  name: string;
}
