export type TransportPhase = "DNS" | "REQUEST" | "BODY";
export type TransportFailureKind = "CONNECTION_FAILED" | "TIMEOUT" | "SECURITY_REJECTED" | "UNKNOWN";

/** Only created around actual resolver/transport/body IO, never policy callbacks.
 * Raw system messages and codes are not exposed or retained on this error. */
export class TransportFailure extends Error {
  readonly kind: TransportFailureKind;
  readonly retryable: boolean;

  constructor(readonly phase: TransportPhase, error: unknown) {
    super(`SAFE_${phase}_TRANSPORT_FAILED`);
    this.name = "TransportFailure";
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    const timeout = typeof code === "string" && ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code);
    const transient = typeof code === "string" && ["EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENETUNREACH", "EHOSTUNREACH"].includes(code);
    const tls = typeof code === "string" && (/^(?:ERR_TLS_|ERR_SSL_)/u.test(code) ||
      ["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_REVOKED"].includes(code));
    this.kind = tls ? "SECURITY_REJECTED" : timeout ? "TIMEOUT"
      : transient || code === "ENOTFOUND" || code === "ENODATA" ? "CONNECTION_FAILED" : "UNKNOWN";
    this.retryable = timeout || transient;
  }
}
