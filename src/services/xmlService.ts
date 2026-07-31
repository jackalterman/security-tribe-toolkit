
export const xmlService = {
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
  }
};
