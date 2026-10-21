/**
 * Signaling protocol exchanged over the WebSocket connection between a
 * child app and the parent (either the parent's own app, or a browser
 * viewing the "browser portal" the parent app serves on the LAN). This is
 * a thin relay: the actual screen video travels peer-to-peer over WebRTC
 * once the offer/answer/ICE exchange below has completed.
 *
 * A child device may be watched by more than one viewer at once (the
 * parent's own app and any number of browser tabs on the home network).
 * The five per-session message types below (ViewRequest, ConsentResponse,
 * SdpOffer, SdpAnswer, IceCandidateMessage) and StopViewing therefore
 * carry routing info that the signaling server fills in as it relays:
 * a message heading to a specific child carries `viewerId` (which viewing
 * session it's for — the child may be running several concurrent
 * RTCPeerConnections, one per viewer); a message heading to a specific
 * viewer carries `childId` instead (which child it's about — a viewer,
 * especially a browser, may be watching several children at once). Each
 * side only ever needs to populate/read the one field relevant to it; the
 * server swaps `viewerId` for `childId` (and vice versa) when relaying
 * between a child's connection and a viewer's. The parent app's own
 * built-in viewer uses the fixed id "local".
 */

export interface JoinAck {
  type: "join-ack";
  accepted: boolean;
  parentName: string;
  reason?: string;
}

/** A viewer (the parent app, or a browser portal session) asks a specific child device to start streaming its screen. */
export interface ViewRequest {
  type: "view-request";
  viewerId?: string;
  childId?: string;
}

/**
 * Child's acknowledgement that it is starting to stream in response to a
 * ViewRequest. On a parent-owned/managed device this is sent automatically
 * (no interactive prompt) — it exists in the protocol mainly so the viewer
 * knows a stream is coming and can distinguish "starting" from "the
 * device is offline / can't capture its screen".
 */
export interface ConsentResponse {
  type: "consent-response";
  granted: boolean;
  reason?: string;
  viewerId?: string;
  childId?: string;
}

export interface SdpOffer {
  type: "offer";
  sdp: string;
  viewerId?: string;
  childId?: string;
}

export interface SdpAnswer {
  type: "answer";
  sdp: string;
  viewerId?: string;
  childId?: string;
}

export interface IceCandidateMessage {
  type: "ice-candidate";
  candidate: RTCIceCandidateInit;
  viewerId?: string;
  childId?: string;
}

/** A viewer tells the child device to stop sharing/streaming to it specifically. */
export interface StopViewing {
  type: "stop-viewing";
  viewerId?: string;
  childId?: string;
}

/**
 * Parent has revoked this device's pairing (child) or session (browser
 * viewer) — e.g. it reset the family code because it may have leaked.
 * Sent right before disconnecting; a child device that is offline at the
 * time instead gets this as the `reason` on a rejected JoinAck the next
 * time it tries to reconnect with its now-invalid stored code.
 */
export interface KickedMessage {
  type: "kicked";
  reason?: string;
}

export interface ChildInfo {
  id: string;
  name: string;
}

/** Sent to a newly-connected viewer so it can render the current list without waiting for individual join events. */
export interface ChildrenListMessage {
  type: "children-list";
  children: ChildInfo[];
}

/** Broadcast to every connected viewer when a child device joins. */
export interface ChildJoinedMessage {
  type: "child-joined";
  child: ChildInfo;
}

/** Broadcast to every connected viewer when a child device disconnects. */
export interface ChildLeftMessage {
  type: "child-left";
  childId: string;
}

export type SignalingMessage =
  | JoinAck
  | ViewRequest
  | ConsentResponse
  | SdpOffer
  | SdpAnswer
  | IceCandidateMessage
  | StopViewing
  | KickedMessage
  | ChildrenListMessage
  | ChildJoinedMessage
  | ChildLeftMessage;
