
export interface JwtHeader {
  alg: 'HS256' | 'RS256' | string;
  typ: string;
}

export interface JwtPayload {
  [key: string]: any;
  iss?: string;
  sub?: string;
  aud?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
}

export interface DecodedJwt {
  header: JwtHeader;
  payload: JwtPayload;
  signature: string;
  raw: {
    header: string;
    payload: string;
    token: string;
  };
}

export interface VerificationResult {
  isValid: boolean;
  reason: string;
}

export interface DecoderData {
    token: string;
    key: string;
    audience?: string;
    issuer?: string;
}

export interface KeyPair {
    publicKey: string;
    privateKey: string;
    jwks: any;
    keyId: string;
}

export type ItemType = 'certificate' | 'jwt' | 'key' | 'secret' | 'request';

export interface CollectionItem {
    id: string;
    type: ItemType;
    title: string;
    content: string;
    metadata: any;
    timestamp: number;
}
