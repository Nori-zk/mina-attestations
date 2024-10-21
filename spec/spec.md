# Technical Specification for Mina Credentials

This document is a low-level technical specification for the Mina Credentials system.
It is intended as document for the accompanying codebase and implementators.
It does not include security proofs or motivations for the design choices,
see the RFC for such discussions.

# Metadata

Metadata SHOULD NOT be constrained during the creation of a credential.
Metadata MUST NOT be used to determine the validity of a credential or its issuer.
Metadata MUST only be used to present information about the credential in a human-readable way
inside wallets and other applications for easy identification and selection.
Metadata MUST NOT be used to make trust decisions.
Metadata MUST NOT be presented to the verifier during the presentation of a credential.

# Formats

## Mina Credential

A credential is a set of attributes and an owner:

```javascript
type Attributes = {
  [key: string]: Any, // any o1js type
}

type Credential = {
  owner: PublicKey,       // the owners public key
  metaHash: Field,        // hash of arbitrary metadata
  attributes: Attributes, // struct of hidden attributes (e.g. age, name, SSN)
}
```

Is is stored along with metadata and the version of the credential:

```javascript
type Witness =
  | { type: "simple",
      issuer: PublicKey,
      issuerSignature: Signature,
    }
  | { type: "recursive",
      credVK: VerificationKey,
      credIdent: Field,
      credProof: Proof,
    }
```

```javascript
type StoredCredential = {
  version: "v0",
  witness: Witness,
  metadata: Metadata,
  credential: Credential,
}
```

Wallets MUST import/export credentials in this format, but MAY store them in any format internally.
Wallets MUST validate the credential before importing it, we describe the validation procedure in this document.
Note: validating a credential does not require access to the owner's private key.

## Mina Credential Presentation

The presentation proof is encoded as follows:

```javascript
type Presentation = {
  version: "v0",
  proof: Proof,
  claims: Claims,
}
```

## Mina Credential Metadata

Metadata is a general key-value map. We standardize a few fields for interoperability across wallets:
so that e.g. wallet can display an issuer name and icon for any compatible credential.
Issuers may add their own fields as needed, such custom fields MUST NOT use the `mina` prefix.

Standardized fields are:

- `minaCredName`: The name of the credential: utf-8 encoded string.
- `minaIssuerName`: The name of the issuer: utf-8 encoded string.
- `minaDescription`: A human-readable description of the credential: utf-8 encoded string.
- `minaIcon`: A byte array representing an icon for the credential.

Any fields (inlcuding the standardized ones) MAY be omitted,
wallets MUST handle the absence of any field gracefully, e.g. with a default icon.
Wallets MUST NOT make trust decisions based on metadata, in particular,
wallets MUST NOT verify the issuer based on the `minaIssuerName` field.
Wallets MAY ignore ANY metadata field.

```javascript
type Metadata = {
  minaCredName: String,
  minaIssuerName: String,
  minaDescription: String,
  minaIcon: Uint8Array, // svg, jpg, png, webp, etc.
  ...
}
```

The `metaHash` field of the credential is the hash of the metadata.
The `metaHash` fiueld MUST be computed using `Keccak256` over the metadata.

```javascript
metaHash = Keccak256.hash(metadata)
```

# Protocols

## Presentations

- The presentation proofs MUST NOT be reused.
- The presentation proofs MUST be generated for each presentation.
- The presentation MUST NOT contain the "context" field, which MUST be recomputed by the verifier.
- The presentation MUST NOT include the `metadata` of the credential.

### Public Inputs

The public inputs for the presentations circuits (simple and recursive) are:

```javascript
type PublicInput = {
  context: Field, // context : specified later
  claims: Claims  // application specific public inputs.
}
```

### Circuit: Present Simple Credential

A standardized circuit for presenting simple credentials.

The circuit verifies two signatures: one from the issuer and one from the owner.

```javascript
// the private inputs for the circuit
type PrivateInput = {
  credential: Credential,
  issuerPk: PublicKey,
  issuerSignature: Signature,
  ownerSignature: Signature,
}

// hash the credential
let credHash = Poseidon.hashPacked(Credential, credential);

// verify the credential issuer signature
issuerSignature.verify(issuerPk, credHash);

// convert issuerPK to opaque field element
let issuer = Poseidon.hashWithPrefix(
  "mina-cred:v0:simple",  // sep. the domain of "simple" and "recursive" issuers
  issuerPk
);

// verify the credential owners signature
ownerSignature.verify(
  credential.owner,
  [context, issuer, credHash]
);

// verify application specific constraints using the standard API
applicationConstraints(
  credential, // hidden attributes/owner
  issuer,     // potentially hidden issuer
  claims,     // application specific public input
)
```

### Circuit: Present Recursive Credential

A standardized circuit for presenting recursive credentials.

The circuit verifies a proof "from" the issuing authority and a signature from the owner.

```javascript
// the private inputs for the circuit
type PrivateInput = {
  credVK: VerificationKey,
  credIdent: Field,
  credProof: Proof,
  credential: Credential,
  ownerSignature: Signature,
}

// hash the credential
let credHash = Poseidon.hashPacked(Credential, credential);

// verify the credential proof
credProof.publicInput.assertEquals([credHash, credIdent]);
credProof.verify(credVK);

// the issuer is identified by the recursive relation and public input
let issuer = Poseidon.hashWithPrefix(
  "mina-cred:v0:recursive", // sep. the domain of "simple" and "recursive" issuers
  [vk.hash, credIdent]      // identifies the issuing authority / validation logic
);

// verify the credential owners signature
ownerSignature.verify(
  credential.owner,
  [context, issuer, credHash]
);

// verify application specific constraints using the standard API
applicationConstraints(
  credential, // hidden attributes/owner
  issuer,     // potentially hidden issuer
  claims,     // application specific public input
)
```

# Context Binding

The verifier computes the context (out-of-circuit) as:

```javascript
context = Poseidon.hashWithPrefix(
  "mina-cred:v0:context", // for versioning
  [
    type,                       // seperates different types of verifiers
    presentationCircuitVK.hash, // binds the presentation to the relation
    nonce,                      // a random nonce to prevent replay attacks
    verifierIdentity,           // verifiers identifier
    action,                     // the "action" being performed (e.g. login, transaction hash etc.)
    claims,                     // the public input (the set of "claims" being presented)
  ]
)
```

The nonce MUST be generated as follows:

```javascript
let nonce = Poseidon.hashWithPrefix(
  "mina-cred:v0:nonce",
  [serverNonce, clientNonce]
)
```

- The `clientNonce` MUST be a uniformly random field element generated by the client.
- The `clientNonce` MUST never be reused.
- The `serverNonce` MAY be zero in applications where storing the set of expended nonces indefinitely is not a concern.

Usual applications of `serverNonce` is to seperate the nonce space into "epochs" to prevent storage of all nonces indefinitely:
for instance, a timestamp may be used and validity requires the timestamp to be recent.
Allowing the server to only store nonces for a limited time.

## zkApp

```javascript
let type = Keccak256.hash("zk-app")

let verifierIdentity = "Mina Address of the ZK App"

let action = Poseidon.hash([METHOD_ID, ARG1, ARG2, ...])
```

The ZK app MUST check the validity of the presentation proof and the claims.

## Web Application

[Uniform Resource Identifier](https://datatracker.ietf.org/doc/html/rfc3986)

```javascript
let type = Keccak256.hash("https");

let verifierIdentity = Keccak256.hash("example.com");

let action = Keccak256.hash(HTTP_REQUEST);
```

The scheme MUST be `https`.

Keccak is used to improve efficiency when the HTTP request is long: such as uploading a file.
