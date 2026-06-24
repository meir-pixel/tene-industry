# SHAPE_DATA_CONTRACT_V2

This document defines the approved Shape Editor data contract after the ownership correction between Shape and Order Item.

It supersedes and clarifies `SHAPE_DATA_CONTRACT.md` for Shape Editor approvals.

Scope:

- Documentation only.
- No UI changes.
- No rendering changes.
- No new shape families or shape presets.
- No BVBS implementation yet.
- No machine integration implementation yet.
- No machine vendor adapters yet.

The Shape Editor must not return drawing-only data. It must return production-ready structured data that Orders/Items can store as an immutable snapshot and pass to production cards, pricing, and weight calculation.

## Architectural Corrections In V2

- Shape describes geometry only.
- Quantity does not belong to Shape.
- Quantity belongs to Order Item.
- Every approved shape has stable identity fields: `shapeId`, `shapeType`, `family`.
- Every approved shape has version fields: `contractVersion`, `shapeVersion`.
- Orders store historical shape snapshots. Future versions of the same shape must not mutate old orders.
- Machine output is structured for generic output plus future machine vendor profiles.

## Shape vs Order Item Ownership

Shape owns:

- Shape identity: `shapeId`, `shapeType`, `family`.
- Shape versioning: `contractVersion`, `shapeVersion`.
- Geometry.
- Dimensions.
- Diameters.
- Calculated lengths for one approved shape unit.
- Calculated weight for one approved shape unit.
- Shape validation results.
- Generic machine-ready structure.

Order Item owns:

- `quantity`.
- Order status.
- Production status.
- Delivery status.
- Customer data.
- Pricing snapshot.
- Customer/order context.
- Item totals derived from `shapeSnapshot.calculated * quantity`.

Important rule:

`displayName` is only a human label. It is not a unique identifier and must not be used as the primary key for shape identity.

## Common Contract Envelope

Every approved shape returns this envelope:

```json
{
  "contractVersion": 1,
  "shapeVersion": 1,
  "shapeId": "generated-guid",
  "shapeType": "u_bar",
  "family": "bars",
  "source": "shape-editor",
  "approvedAt": "ISO-8601 timestamp",
  "displayName": "optional human label",
  "data": {},
  "calculated": {},
  "machineOutput": {
    "generic": {},
    "machineProfiles": {
      "MEP": {},
      "PEDAX": {},
      "SCHNELL": {}
    }
  },
  "validation": {
    "valid": true,
    "errors": []
  }
}
```

Required common fields:

| Field | Type | Required | Owner | Description |
|---|---|---:|---|---|
| `contractVersion` | integer | yes | Shape | Shape data contract version. Starts at `1`. |
| `shapeVersion` | integer | yes | Shape | Version of this shape definition/snapshot. Starts at `1`. |
| `shapeId` | string | yes | Shape | Stable generated identifier for the approved shape snapshot or reusable shape definition. |
| `shapeType` | string | yes | Shape | Shape subtype inside the family, for example `straight_bar`, `u_bar`, `mesh_rectangular`, `round_pile_cage`. |
| `family` | string | yes | Shape | Must be `bars`, `mesh`, or `piles`. |
| `source` | string | yes | Shape | Must identify the producer, usually `shape-editor`. |
| `approvedAt` | string | yes | Shape | ISO-8601 timestamp of approval. |
| `displayName` | string | no | Shape | Optional human label only. Not unique. |
| `data` | object | yes | Shape | User-entered production fields. |
| `calculated` | object | yes | Shape | Derived production fields calculated at approval time for one shape unit. |
| `machineOutput` | object | yes | Shape | Future-ready machine output structure. Not BVBS and not a live command. |
| `validation` | object | yes | Shape | Approval validation result. Must be valid before Orders accept the shape. |

Units:

- Lengths: millimeters.
- Diameters: millimeters.
- Angles: degrees.
- Weight: kilograms.
- Quantity: Order Item units, outside Shape.

Weight basis:

- Steel kg/meter is calculated by the shared steel weight rule: `diameterMm * diameterMm * 0.00617`.
- `calculated.weightKg` is always the weight of one approved shape unit.
- Order Item calculates item weight as `shapeSnapshot.calculated.weightKg * quantity`.

## Machine Output Structure

The old flat `machineOutput` structure is replaced by this structure:

```json
{
  "machineOutput": {
    "generic": {},
    "machineProfiles": {
      "MEP": {},
      "PEDAX": {},
      "SCHNELL": {}
    }
  }
}
```

Rules:

- `generic` contains vendor-neutral production fields.
- `machineProfiles` reserves vendor-specific payloads for future adapters.
- `MEP`, `PEDAX`, and `SCHNELL` are placeholders only.
- This contract does not implement BVBS.
- This contract does not implement live machine integration.
- Empty vendor profiles are valid until adapters are implemented.

Recommended placeholder profile:

```json
{
  "status": "not_implemented",
  "profileVersion": null,
  "payload": null
}
```

## 1. bars

Simple bar shapes only: straight bars, L shapes, U shapes, stirrups, and regular bent bars.

Bars use `sides[]` and `angles[]`.

Bars do not own `quantity`.

### User Fields

The Shape Editor must collect or receive:

| Field | Type | Required | Owner | Description |
|---|---|---:|---|---|
| `shapeId` | string | yes | Shape | Generated shape identifier. |
| `shapeType` | string | yes | Shape | Bar subtype, for example `straight_bar`, `u_bar`, `stirrup`. |
| `family` | string | yes | Shape | Must be `bars`. |
| `sides` | number[] | yes | Shape | Segment lengths in bending-path order. |
| `angles` | number[] | yes | Shape | Bend angle after each side except the last side. |
| `diameter` | number | yes | Shape | Main bar diameter. |
| `displayName` | string | no | Shape | Optional human label. |

`quantity` may appear only in an Order Item wrapper around the shape snapshot. It is optional in examples and is owned by Order Item.

### Saved JSON

```json
{
  "contractVersion": 1,
  "shapeVersion": 1,
  "shapeId": "generated-guid",
  "shapeType": "u_bar",
  "family": "bars",
  "source": "shape-editor",
  "approvedAt": "2026-06-24T09:00:00+03:00",
  "displayName": "U bar",
  "data": {
    "sides": [350, 1200, 350],
    "angles": [90, 90],
    "diameter": 12
  },
  "calculated": {
    "totalLengthMm": 1900,
    "weightKg": 1.69,
    "bendCount": 2
  },
  "machineOutput": {
    "generic": {
      "family": "bars",
      "shapeType": "u_bar",
      "diameter": 12,
      "segments": [
        { "index": 1, "lengthMm": 350, "bendAfterDeg": 90 },
        { "index": 2, "lengthMm": 1200, "bendAfterDeg": 90 },
        { "index": 3, "lengthMm": 350, "bendAfterDeg": null }
      ],
      "totalLengthMm": 1900,
      "bendCount": 2
    },
    "machineProfiles": {
      "MEP": { "status": "not_implemented", "profileVersion": null, "payload": null },
      "PEDAX": { "status": "not_implemented", "profileVersion": null, "payload": null },
      "SCHNELL": { "status": "not_implemented", "profileVersion": null, "payload": null }
    }
  },
  "validation": {
    "valid": true,
    "errors": []
  }
}
```

### Calculated Fields

In V2, all calculated bar values are for one approved bar shape unit.

| Field | Formula |
|---|---|
| `totalLengthMm` | `sum(sides)` |
| `bendCount` | `angles.length` |
| `weightKg` | `(totalLengthMm / 1000) * kgPerMeter(diameter)` |

Required calculated fields:

- `totalLengthMm`
- `weightKg`
- `bendCount`

### Validation Rules

- `contractVersion === 1`.
- `shapeVersion >= 1`.
- `shapeId` is present and unique for the approved snapshot/definition.
- `shapeType` is present.
- `family === "bars"`.
- `sides` is a non-empty array.
- Every `sides[]` value is finite and `> 0`.
- `angles.length === sides.length - 1`.
- Every `angles[]` value is finite and between `-360` and `360`.
- `diameter > 0`.
- Shape must not contain `quantity`.
- Bars must not use mesh fields: `length`, `width`, `longitudinalSpacing`, `transverseSpacing`, `edgeLeft`, `edgeRight`, `edgeTop`, `edgeBottom`.
- Bars must not use pile fields: `pileDiameter`, `pileLength`, `longitudinalBars`, `spiralDiameter`, `spiralZones`.

### Machine Output Fields

`machineOutput.generic` required fields:

- `family`
- `shapeType`
- `diameter`
- `segments[]`
- `segments[].index`
- `segments[].lengthMm`
- `segments[].bendAfterDeg`
- `totalLengthMm`
- `bendCount`

`machineOutput.machineProfiles` required keys:

- `MEP`
- `PEDAX`
- `SCHNELL`

### Fields Used By Orders/Items

Orders/Items store:

- `shapeId`
- `shapeType`
- `family`
- `contractVersion`
- `shapeVersion`
- `displayName`
- `data.sides`
- `data.angles`
- `data.diameter`
- `calculated.totalLengthMm`
- `calculated.weightKg`
- `calculated.bendCount`
- full approved shape snapshot

Orders/Items own separately:

- `quantity`
- item status fields
- customer/order context
- pricing snapshot

### Fields Used By Production Cards

Production cards use Shape fields:

- `shapeId`
- `shapeType`
- `family`
- `displayName`
- `sides`
- `angles`
- `diameter`
- `totalLengthMm`
- `weightKg`
- `bendCount`

Production cards use Order Item fields:

- `quantity`
- production status
- delivery status
- customer/order context

### Fields Used By Pricing / Weight Calculation

Pricing and weight calculation use Shape fields:

- `diameter`
- `totalLengthMm`
- `weightKg`
- `bendCount` when pricing has bend labor rules

Pricing and weight calculation use Order Item fields:

- `quantity`
- pricing snapshot
- item total length: `shape.calculated.totalLengthMm * quantity`
- item total weight: `shape.calculated.weightKg * quantity`

## 2. mesh

Mesh only. Mesh does not use `sides[]` or `angles[]`.

Mesh does not own `quantity`.

### User Fields

The Shape Editor must collect or receive:

| Field | Type | Required | Owner | Description |
|---|---|---:|---|---|
| `shapeId` | string | yes | Shape | Generated shape identifier. |
| `shapeType` | string | yes | Shape | Mesh subtype, for example `mesh_rectangular`. |
| `family` | string | yes | Shape | Must be `mesh`. |
| `length` | number | yes | Shape | Overall mesh length. |
| `width` | number | yes | Shape | Overall mesh width. |
| `longitudinalDiameter` | number | yes | Shape | Diameter of longitudinal bars. |
| `longitudinalSpacing` | number | yes | Shape | Spacing between longitudinal bars. |
| `transverseDiameter` | number | yes | Shape | Diameter of transverse bars. |
| `transverseSpacing` | number | yes | Shape | Spacing between transverse bars. |
| `edgeLeft` | number | yes | Shape | Left edge offset. Use `0` if none. |
| `edgeRight` | number | yes | Shape | Right edge offset. Use `0` if none. |
| `edgeTop` | number | yes | Shape | Top edge offset. Use `0` if none. |
| `edgeBottom` | number | yes | Shape | Bottom edge offset. Use `0` if none. |
| `displayName` | string | no | Shape | Optional human label. |

`quantity` may appear only in an Order Item wrapper around the shape snapshot. It is optional in examples and is owned by Order Item.

### Saved JSON

```json
{
  "contractVersion": 1,
  "shapeVersion": 1,
  "shapeId": "generated-guid",
  "shapeType": "mesh_rectangular",
  "family": "mesh",
  "source": "shape-editor",
  "approvedAt": "2026-06-24T09:00:00+03:00",
  "displayName": "Mesh 600x250 diameter 8@20 / diameter 8@20",
  "data": {
    "length": 600,
    "width": 250,
    "longitudinalDiameter": 8,
    "longitudinalSpacing": 20,
    "transverseDiameter": 8,
    "transverseSpacing": 20,
    "edgeLeft": 0,
    "edgeRight": 0,
    "edgeTop": 0,
    "edgeBottom": 0
  },
  "calculated": {
    "longitudinalBarCount": 13,
    "transverseBarCount": 31,
    "longitudinalTotalLengthMm": 7800,
    "transverseTotalLengthMm": 7750,
    "totalLengthMm": 15550,
    "weightKg": 6.14
  },
  "machineOutput": {
    "generic": {
      "family": "mesh",
      "shapeType": "mesh_rectangular",
      "length": 600,
      "width": 250,
      "longitudinalDiameter": 8,
      "longitudinalSpacing": 20,
      "transverseDiameter": 8,
      "transverseSpacing": 20,
      "edgeLeft": 0,
      "edgeRight": 0,
      "edgeTop": 0,
      "edgeBottom": 0,
      "longitudinalBarCount": 13,
      "transverseBarCount": 31,
      "totalLengthMm": 15550
    },
    "machineProfiles": {
      "MEP": { "status": "not_implemented", "profileVersion": null, "payload": null },
      "PEDAX": { "status": "not_implemented", "profileVersion": null, "payload": null },
      "SCHNELL": { "status": "not_implemented", "profileVersion": null, "payload": null }
    }
  },
  "validation": {
    "valid": true,
    "errors": []
  }
}
```

### Calculated Fields

In V2, all calculated mesh values are for one approved mesh unit.

| Field | Formula |
|---|---|
| `longitudinalBarCount` | Count of bars across `width` after edge offsets and spacing rules. |
| `transverseBarCount` | Count of bars across `length` after edge offsets and spacing rules. |
| `longitudinalTotalLengthMm` | `longitudinalBarCount * length` |
| `transverseTotalLengthMm` | `transverseBarCount * width` |
| `totalLengthMm` | `longitudinalTotalLengthMm + transverseTotalLengthMm` |
| `weightKg` | Longitudinal weight plus transverse weight, using each direction diameter. |

Required calculated fields:

- `longitudinalBarCount`
- `transverseBarCount`
- `totalLengthMm`
- `weightKg`

### Validation Rules

- `contractVersion === 1`.
- `shapeVersion >= 1`.
- `shapeId` is present and unique for the approved snapshot/definition.
- `shapeType` is present.
- `family === "mesh"`.
- `length > 0`.
- `width > 0`.
- `longitudinalDiameter > 0`.
- `longitudinalSpacing > 0`.
- `transverseDiameter > 0`.
- `transverseSpacing > 0`.
- `edgeLeft >= 0`.
- `edgeRight >= 0`.
- `edgeTop >= 0`.
- `edgeBottom >= 0`.
- `edgeLeft + edgeRight < length`.
- `edgeTop + edgeBottom < width`.
- Shape must not contain `quantity`.
- Mesh must not use `sides[]` or `angles[]`.
- Mesh must not use pile fields: `pileDiameter`, `pileLength`, `longitudinalBars`, `spiralDiameter`, `spiralZones`.

### Machine Output Fields

`machineOutput.generic` required fields:

- `family`
- `shapeType`
- `length`
- `width`
- `longitudinalDiameter`
- `longitudinalSpacing`
- `transverseDiameter`
- `transverseSpacing`
- `edgeLeft`
- `edgeRight`
- `edgeTop`
- `edgeBottom`
- `longitudinalBarCount`
- `transverseBarCount`
- `totalLengthMm`

`machineOutput.machineProfiles` required keys:

- `MEP`
- `PEDAX`
- `SCHNELL`

### Fields Used By Orders/Items

Orders/Items store:

- `shapeId`
- `shapeType`
- `family`
- `contractVersion`
- `shapeVersion`
- `displayName`
- all `data` mesh dimensions and diameters
- `calculated.longitudinalBarCount`
- `calculated.transverseBarCount`
- `calculated.totalLengthMm`
- `calculated.weightKg`
- full approved shape snapshot

Orders/Items own separately:

- `quantity`
- item status fields
- customer/order context
- pricing snapshot

### Fields Used By Production Cards

Production cards use Shape fields:

- `shapeId`
- `shapeType`
- `family`
- `displayName`
- `length`
- `width`
- `longitudinalDiameter`
- `longitudinalSpacing`
- `transverseDiameter`
- `transverseSpacing`
- edge offsets
- bar counts
- `totalLengthMm`
- `weightKg`

Production cards use Order Item fields:

- `quantity`
- production status
- delivery status
- customer/order context

### Fields Used By Pricing / Weight Calculation

Pricing and weight calculation use Shape fields:

- `length`
- `width`
- `longitudinalDiameter`
- `longitudinalSpacing`
- `transverseDiameter`
- `transverseSpacing`
- bar counts
- `totalLengthMm`
- `weightKg`

Pricing and weight calculation use Order Item fields:

- `quantity`
- pricing snapshot
- item total length: `shape.calculated.totalLengthMm * quantity`
- item total weight: `shape.calculated.weightKg * quantity`

## 3. piles

Pile cages only. Pile cages do not use `sides[]` or `angles[]`.

Pile cages do not own `quantity`.

### User Fields

The Shape Editor must collect or receive:

| Field | Type | Required | Owner | Description |
|---|---|---:|---|---|
| `shapeId` | string | yes | Shape | Generated shape identifier. |
| `shapeType` | string | yes | Shape | Pile subtype, for example `round_pile_cage`. |
| `family` | string | yes | Shape | Must be `piles`. |
| `pileDiameter` | number | yes | Shape | Outside pile cage diameter. |
| `pileLength` | number | yes | Shape | Overall pile cage length. |
| `longitudinalBars` | integer | yes | Shape | Number of longitudinal bars around the circumference. |
| `longitudinalDiameter` | number | yes | Shape | Diameter of longitudinal bars. |
| `spiralDiameter` | number | yes | Shape | Diameter of spiral bar. |
| `spiralZones` | object[] | yes | Shape | Ordered spiral zone definitions. |
| `displayName` | string | no | Shape | Optional human label. |

Spiral zone fields:

| Field | Type | Required | Owner | Description |
|---|---|---:|---|---|
| `name` | string | yes | Shape | Zone name, for example `Zone A`. |
| `length` | number | yes | Shape | Zone length. |
| `pitch` | number | yes | Shape | Spiral pitch in this zone. |

`quantity` may appear only in an Order Item wrapper around the shape snapshot. It is optional in examples and is owned by Order Item.

### Saved JSON

```json
{
  "contractVersion": 1,
  "shapeVersion": 1,
  "shapeId": "generated-guid",
  "shapeType": "round_pile_cage",
  "family": "piles",
  "source": "shape-editor",
  "approvedAt": "2026-06-24T09:00:00+03:00",
  "displayName": "Pile diameter 70 L=2200",
  "data": {
    "pileDiameter": 70,
    "pileLength": 2200,
    "longitudinalBars": 26,
    "longitudinalDiameter": 22,
    "spiralDiameter": 8,
    "spiralZones": [
      { "name": "Zone A", "length": 70, "pitch": 10 },
      { "name": "Zone B", "length": 200, "pitch": 20 },
      { "name": "Zone C", "length": 1350, "pitch": 20 }
    ]
  },
  "calculated": {
    "totalLongitudinalLengthMm": 57200,
    "totalSpiralLengthMm": 17012,
    "totalLengthMm": 74212,
    "weightKg": 176.35
  },
  "machineOutput": {
    "generic": {
      "family": "piles",
      "shapeType": "round_pile_cage",
      "pileDiameter": 70,
      "pileLength": 2200,
      "longitudinalBars": 26,
      "longitudinalDiameter": 22,
      "spiralDiameter": 8,
      "spiralZones": [
        { "index": 1, "name": "Zone A", "startMm": 0, "lengthMm": 70, "pitchMm": 10 },
        { "index": 2, "name": "Zone B", "startMm": 70, "lengthMm": 200, "pitchMm": 20 },
        { "index": 3, "name": "Zone C", "startMm": 270, "lengthMm": 1350, "pitchMm": 20 }
      ],
      "totalLongitudinalLengthMm": 57200,
      "totalSpiralLengthMm": 17012,
      "totalLengthMm": 74212
    },
    "machineProfiles": {
      "MEP": { "status": "not_implemented", "profileVersion": null, "payload": null },
      "PEDAX": { "status": "not_implemented", "profileVersion": null, "payload": null },
      "SCHNELL": { "status": "not_implemented", "profileVersion": null, "payload": null }
    }
  },
  "validation": {
    "valid": true,
    "errors": []
  }
}
```

### Calculated Fields

In V2, all calculated pile cage values are for one approved pile cage unit.

| Field | Formula |
|---|---|
| `totalLongitudinalLengthMm` | `pileLength * longitudinalBars` |
| `totalSpiralLengthMm` | Sum of spiral length per zone. Exact formula belongs to PileCageEngine calculation rules. |
| `totalLengthMm` | `totalLongitudinalLengthMm + totalSpiralLengthMm` |
| `weightKg` | Longitudinal weight plus spiral weight, using each diameter. |

Required calculated fields:

- `totalLongitudinalLengthMm`
- `totalSpiralLengthMm`
- `weightKg`

### Validation Rules

- `contractVersion === 1`.
- `shapeVersion >= 1`.
- `shapeId` is present and unique for the approved snapshot/definition.
- `shapeType` is present.
- `family === "piles"`.
- `pileDiameter > 0`.
- `pileLength > 0`.
- `longitudinalBars` is an integer and `>= 3`.
- `longitudinalDiameter > 0`.
- `spiralDiameter > 0`.
- `spiralZones` is a non-empty array.
- Every zone has a non-empty `name`.
- Every zone `length > 0`.
- Every zone `pitch > 0`.
- `sum(spiralZones.length) <= pileLength`.
- Shape must not contain `quantity`.
- Pile cages must not use `sides[]` or `angles[]`.
- Pile cages must not use mesh fields: `length`, `width`, `longitudinalSpacing`, `transverseSpacing`, `edgeLeft`, `edgeRight`, `edgeTop`, `edgeBottom`.

### Machine Output Fields

`machineOutput.generic` required fields:

- `family`
- `shapeType`
- `pileDiameter`
- `pileLength`
- `longitudinalBars`
- `longitudinalDiameter`
- `spiralDiameter`
- `spiralZones[]`
- `spiralZones[].index`
- `spiralZones[].name`
- `spiralZones[].startMm`
- `spiralZones[].lengthMm`
- `spiralZones[].pitchMm`
- `totalLongitudinalLengthMm`
- `totalSpiralLengthMm`
- `totalLengthMm`

`machineOutput.machineProfiles` required keys:

- `MEP`
- `PEDAX`
- `SCHNELL`

### Fields Used By Orders/Items

Orders/Items store:

- `shapeId`
- `shapeType`
- `family`
- `contractVersion`
- `shapeVersion`
- `displayName`
- all `data` pile cage dimensions, diameters, bar count, and spiral zones
- `calculated.totalLongitudinalLengthMm`
- `calculated.totalSpiralLengthMm`
- `calculated.totalLengthMm`
- `calculated.weightKg`
- full approved shape snapshot

Orders/Items own separately:

- `quantity`
- item status fields
- customer/order context
- pricing snapshot

### Fields Used By Production Cards

Production cards use Shape fields:

- `shapeId`
- `shapeType`
- `family`
- `displayName`
- `pileDiameter`
- `pileLength`
- `longitudinalBars`
- `longitudinalDiameter`
- `spiralDiameter`
- `spiralZones`
- `totalLongitudinalLengthMm`
- `totalSpiralLengthMm`
- `weightKg`

Production cards use Order Item fields:

- `quantity`
- production status
- delivery status
- customer/order context

### Fields Used By Pricing / Weight Calculation

Pricing and weight calculation use Shape fields:

- `pileLength`
- `longitudinalBars`
- `longitudinalDiameter`
- `spiralDiameter`
- `spiralZones`
- `totalLongitudinalLengthMm`
- `totalSpiralLengthMm`
- `weightKg`

Pricing and weight calculation use Order Item fields:

- `quantity`
- pricing snapshot
- item total longitudinal length: `shape.calculated.totalLongitudinalLengthMm * quantity`
- item total spiral length: `shape.calculated.totalSpiralLengthMm * quantity`
- item total weight: `shape.calculated.weightKg * quantity`

## Order Item Wrapper Example

This example shows how quantity wraps the shape snapshot. Quantity is not inside Shape.

```json
{
  "orderItemId": "item-guid",
  "quantity": 10,
  "orderStatus": "draft",
  "productionStatus": "not_started",
  "deliveryStatus": "pending",
  "customerData": {
    "customerId": "customer-guid"
  },
  "pricingSnapshot": {
    "currency": "ILS",
    "unitPrice": null
  },
  "shapeSnapshot": {
    "contractVersion": 1,
    "shapeVersion": 1,
    "shapeId": "generated-guid",
    "shapeType": "u_bar",
    "family": "bars",
    "data": {
      "sides": [350, 1200, 350],
      "angles": [90, 90],
      "diameter": 12
    },
    "calculated": {
      "totalLengthMm": 1900,
      "weightKg": 1.69,
      "bendCount": 2
    }
  },
  "itemCalculated": {
    "totalLengthMm": "shapeSnapshot.calculated.totalLengthMm * quantity",
    "weightKg": "shapeSnapshot.calculated.weightKg * quantity"
  }
}
```

## Acceptance Checklist

A valid V2 approval contract must satisfy all of these:

- Contains `contractVersion`.
- Contains `shapeVersion`.
- Contains `shapeId`.
- Contains `shapeType`.
- Contains `family`.
- Does not contain Shape-owned `quantity`.
- Uses `family === "bars"` only with `sides[]` and `angles[]`.
- Uses `family === "mesh"` only with mesh dimensions, diameters, spacings, and edge offsets.
- Uses `family === "piles"` only with pile cage dimensions, longitudinal bars, spiral diameter, and spiral zones.
- Contains `machineOutput.generic`.
- Contains `machineOutput.machineProfiles.MEP`.
- Contains `machineOutput.machineProfiles.PEDAX`.
- Contains `machineOutput.machineProfiles.SCHNELL`.
- Exposes calculated fields needed by Orders/Items, production cards, pricing, and weight calculation.
- Leaves quantity, item statuses, customer data, and pricing snapshot to Order Item.
