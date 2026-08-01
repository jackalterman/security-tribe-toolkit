
export interface ParsedSamlAssertion {
  issuer?: string;
  nameId?: string;
  nameIdFormat?: string;
  statusCode?: string;
  destination?: string;
  audience?: string;
  inResponseTo?: string;
  attributes: Record<string, string>;
}

export const xmlService = {
  /**
   * Decodes SAML input trying, in order: raw XML -> base64 -> base64 + DEFLATE
   * (HTTP-Redirect binding) -> URL-decode + base64 [+ DEFLATE]. Returns the
   * decoded XML string along with a human-readable label of which path
   * succeeded, so callers can surface it to the user (e.g. "Detected: Base64
   * + DEFLATE (Redirect binding)"). If nothing decodes successfully, the
   * original trimmed input is returned unmodified so downstream XML parsing
   * can surface an accurate parse error.
   */
  async decodeSamlInput(raw: string): Promise<{ xml: string; detected: string }> {
    const input = raw.trim();

    if (input.startsWith('<')) {
      return { xml: input, detected: 'Raw XML' };
    }

    const base64ToBytes = (b64: string): Uint8Array | null => {
      try {
        const clean = b64.replace(/\s/g, '');
        const bin = atob(clean);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      } catch (e) {
        return null;
      }
    };

    const inflate = async (bytes: Uint8Array): Promise<string | null> => {
      if (typeof DecompressionStream === 'undefined') return null;
      try {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        const buf = await new Response(stream).arrayBuffer();
        return new TextDecoder().decode(buf);
      } catch (e) {
        return null;
      }
    };

    // 1. Plain base64 (HTTP-POST binding, or a bare base64 string)
    const rawBytes = base64ToBytes(input);
    if (rawBytes) {
      const asText = new TextDecoder().decode(rawBytes);
      if (asText.trim().startsWith('<')) {
        return { xml: asText, detected: 'Base64' };
      }

      // 2. Base64 + DEFLATE, no URL-encoding wrapper (Redirect binding)
      const inflated = await inflate(rawBytes);
      if (inflated && inflated.trim().startsWith('<')) {
        return { xml: inflated, detected: 'Base64 + DEFLATE (Redirect binding)' };
      }
    }

    // 3. URL-decode first, then retry raw / base64 / base64+DEFLATE
    //    (covers Redirect-binding messages passed as a full query-string value)
    if (/%[0-9A-Fa-f]{2}/.test(input)) {
      try {
        const urlDecoded = decodeURIComponent(input);

        if (urlDecoded.trim().startsWith('<')) {
          return { xml: urlDecoded, detected: 'URL-decoded XML' };
        }

        const urlBytes = base64ToBytes(urlDecoded);
        if (urlBytes) {
          const asText = new TextDecoder().decode(urlBytes);
          if (asText.trim().startsWith('<')) {
            return { xml: asText, detected: 'URL-decoded + Base64' };
          }

          const inflated = await inflate(urlBytes);
          if (inflated && inflated.trim().startsWith('<')) {
            return { xml: inflated, detected: 'URL-decoded + Base64 + DEFLATE (Redirect binding)' };
          }
        }
      } catch (e) {
        // not valid percent-encoding — fall through
      }
    }

    return { xml: input, detected: 'Unrecognized (passed through unmodified)' };
  },

  formatXml(xml: string): string {
    const tab = '  ';
    const normalized = xml.replace(/\r\n/g, '\n').trim();
    const nodes = normalized.replace(/>\s*</g, '><').replace(/>(?=<)/g, '>\r\n').split(/\r\n/);

    let formatted = '';
    let indentLevel = 0;

    nodes.forEach((node) => {
      if (!node) {
        return;
      }

      const trimmed = node.trim();
      const isClosingTag = /^<\//.test(trimmed);
      const isSelfClosing = /<[^>]+\/>$/.test(trimmed);
      const isDeclaration = /^<\?/.test(trimmed);
      const isComment = /^<!--/.test(trimmed);

      if (isClosingTag) {
        indentLevel = Math.max(indentLevel - 1, 0);
      }

      formatted += tab.repeat(indentLevel) + trimmed + '\r\n';

      if (!isClosingTag && !isSelfClosing && !isDeclaration && !isComment && /^<[^>]+>$/g.test(trimmed)) {
        indentLevel += 1;
      }
    });

    return formatted.trim();
  },

  generateMockSamlResponse(params: {
    issuer: string;
    subject: string;
    audience: string;
    acsUrl: string;
    attributes: Record<string, string>;
    issueInstant?: string;
  }): string {
    const id = '_' + Math.random().toString(36).substring(2, 11);
    const instant = params.issueInstant || new Date().toISOString();
    const notOnOrAfter = new Date(Date.now() + 3600000).toISOString(); // +1 hour

    // Attributes XML
    const attributesXml = Object.entries(params.attributes).map(([key, value]) => `
        <saml:Attribute Name="${key}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">
          <saml:AttributeValue xsi:type="xs:string">${value}</saml:AttributeValue>
        </saml:Attribute>`).join('');

    return `
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                ID="${id}"
                Version="2.0"
                IssueInstant="${instant}"
                Destination="${params.acsUrl}"
                Consent="urn:oasis:names:tc:SAML:2.0:consent:unspecified">
  <saml:Issuer>${params.issuer}</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  </samlp:Status>
  <saml:Assertion xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  xmlns:xs="http://www.w3.org/2001/XMLSchema"
                  ID="${'_' + Math.random().toString(36).substring(2, 11)}"
                  Version="2.0"
                  IssueInstant="${instant}">
    <saml:Issuer>${params.issuer}</saml:Issuer>
    <!-- This is a simulated signature block for educational purposes -->
    <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
      <ds:SignedInfo>
        <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
        <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
        <ds:Reference URI="#${id}">
          <ds:Transforms>
            <ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>
            <ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
          </ds:Transforms>
          <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
          <ds:DigestValue>...</ds:DigestValue>
        </ds:Reference>
      </ds:SignedInfo>
      <ds:SignatureValue>...</ds:SignatureValue>
    </ds:Signature>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${params.subject}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${params.acsUrl}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${instant}" NotOnOrAfter="${notOnOrAfter}">
      <saml:AudienceRestriction>
        <saml:Audience>${params.audience}</saml:Audience>
      </saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${instant}" SessionIndex="${id}">
      <saml:AuthnContext>
        <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
      </saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>
      ${attributesXml}
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`.trim();
  },

  generateMockSamlRequest(params: {
    issuer: string;
    acsUrl: string;
    destination: string;
  }): string {
    const id = '_' + Math.random().toString(36).substring(2, 11);
    const instant = new Date().toISOString();

    return `
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                    ID="${id}"
                    Version="2.0"
                    IssueInstant="${instant}"
                    AssertionConsumerServiceURL="${params.acsUrl}"
                    Destination="${params.destination}"
                    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer>${params.issuer}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
                      AllowCreate="true"/>
  <samlp:RequestedAuthnContext Comparison="exact">
    <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
  </samlp:RequestedAuthnContext>
</samlp:AuthnRequest>`.trim();
  },

  generateMockSamlMetadata(params: {
    entityId: string;
    acsUrl?: string;
    ssoUrl?: string;
    type: 'sp' | 'idp';
  }): string {
    const isSP = params.type === 'sp';
    return `
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                     entityID="${params.entityId}">
  ${isSP ? `
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                                 Location="${params.acsUrl || 'https://sp.example.com/acs'}"
                                 index="1"/>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
  </md:SPSSODescriptor>
  ` : `
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
                            Location="${params.ssoUrl || 'https://idp.example.com/sso'}"/>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
  </md:IDPSSODescriptor>
  `}
</md:EntityDescriptor>`.trim();
  },

  /**
   * Parses already-decoded SAML XML (a SAMLRequest or SAMLResponse document)
   * and extracts the fields the HAR-to-Flow Reconstruction detector needs:
   * Issuer, NameID (+ format), status, and any Attributes. Namespace-prefix
   * agnostic — real-world captures use varying prefixes (saml:, saml2:, or
   * none), so elements are matched by local name rather than qualified name.
   *
   * Throws if the XML fails to parse; callers should treat that as "not a
   * valid SAML document" rather than silently returning empty data.
   */
  parseSamlXml(xml: string): ParsedSamlAssertion {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const parserError = doc.getElementsByTagName('parsererror')[0];
    if (parserError) {
      throw new Error('Unable to parse SAML XML: ' + (parserError.textContent || 'malformed document'));
    }

    const byLocalName = (localName: string): Element[] => {
      const all = doc.getElementsByTagName('*');
      const matches: Element[] = [];
      for (let i = 0; i < all.length; i++) {
        if (all[i].localName === localName) matches.push(all[i]);
      }
      return matches;
    };

    // Prefer the first Issuer in document order. A Response typically has a
    // top-level Issuer and a nested Assertion Issuer with the same value; if
    // they ever differ, the top-level (first) one wins as the "authoritative"
    // one for correlation purposes.
    const issuerEl = byLocalName('Issuer')[0];
    const nameIdEl = byLocalName('NameID')[0];
    const statusCodeEl = byLocalName('StatusCode')[0];
    const audienceEl = byLocalName('Audience')[0];
    const rootEl = byLocalName('Response')[0] || byLocalName('AuthnRequest')[0];

    const attributes: Record<string, string> = {};
    byLocalName('Attribute').forEach(attrEl => {
      const name = attrEl.getAttribute('Name') || attrEl.getAttribute('FriendlyName') || 'unknown';
      const values: string[] = [];
      const children = attrEl.getElementsByTagName('*');
      for (let i = 0; i < children.length; i++) {
        if (children[i].localName === 'AttributeValue') {
          const text = children[i].textContent?.trim();
          if (text) values.push(text);
        }
      }
      if (values.length > 0) {
        attributes[name] = values.join(', ');
      }
    });

    return {
      issuer: issuerEl?.textContent?.trim() || undefined,
      nameId: nameIdEl?.textContent?.trim() || undefined,
      nameIdFormat: nameIdEl?.getAttribute('Format') || undefined,
      statusCode: statusCodeEl?.getAttribute('Value') || undefined,
      destination: rootEl?.getAttribute('Destination') || undefined,
      audience: audienceEl?.textContent?.trim() || undefined,
      inResponseTo: rootEl?.getAttribute('InResponseTo') || undefined,
      attributes,
    };
  },

  /**
   * Convenience wrapper for the common case: takes a raw SAMLRequest/
   * SAMLResponse value straight off the wire (still base64/DEFLATE encoded,
   * as captured in a HAR) and returns both the decoded XML and the parsed
   * fields in one call.
   */
  async parseSamlResponse(raw: string): Promise<ParsedSamlAssertion & { xml: string; detected: string }> {
    const { xml, detected } = await this.decodeSamlInput(raw);
    const parsed = this.parseSamlXml(xml);
    return { ...parsed, xml, detected };
  }
};
