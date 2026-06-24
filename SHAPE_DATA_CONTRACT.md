# SHAPE_DATA_CONTRACT

This document defines exactly what the Shape Editor returns when the user approves a shape.

Scope:

- Documentation only.
- No UI changes.
- No rendering changes.
- No new shape families or shape presets.
- No BVBS implementation yet.
- No machine integration implementation yet.

The Shape Editor must not return drawing-only data. It must return production-ready structured data that Orders/Items can store as an immutable snapshot and pass to production cards, pricing, and weight calculation.

## Contract Envelope

Every approved shape returns this envelope:

```json
{
  "contractVersion": 1,
  "family": "bars | mesh | piles",
  "source": "shape-editor",
  "approvedAt": "ISO-8601 timestamp",
  "displayName": "optional user label",
  "data": {},
  "calculated": {},
  "machineOutput": {},
  "validation": {
    "valid": true,
    "errors": []
  }
}
```

Rules:

- `family` is mandatory and must be one of `bars`, `mesh`, `piles`.
- `data` contains user-entered production fields.
- `calculated` contains values derived from `data` at approval time.
- `machineOutput` is a structured future-ready export payload, not BVBS and not a live machine command.
- `validation.valid` must be `true` before Orders/Items accept the shape.
- Orders must store the whole approved object as a snapshot. They must not store only SVG, canvas, or drawing coordinates.

## Common Field Rules

Units:

- Lengths: millimeters.
- Diameters: millimeters.
- Angles: degrees.
- Weight: kilograms.
- Quantity: item quantity in units.

Weight basis:

- Steel kg/meter is calculated by the shared steel weight rule: `diameterMm * diameterMm * 0.00617`.
- `weightKg` is the total for the approved shape payload and quantity when quantity is part of the shape contract.
- If Orders own quantity for a family, Orders may multiply the single-unit shape weight, but the shape snapshot must still expose enough fields to calculate it deterministically.

## 1. bars

Simple bar shapes only: straight bars, L shapes, U shapes, stirrups, and regular bent bars.

Bars use `sides[]` and `angles[]`.

### User Fields

The Shape Editor must collect or receive:

| Field | Type | Required | Description |
|---|---|---:|---|
| `sides` | number[] | yes | Segment lengths in bending-path order. |
| `angles` | number[] | yes | Bend angle after each side except the last side. |
| `diameter` | number | yes | Main bar diameter. |
| `quantity` | integer | yes | Number of identical bars. |
| `shapeId` | string | no | Preset/custom shape identifier. |
| `displayName` | string | no | Human-readable label. |

### Saved JSON

```json
{
  "contractVersion": 1,
  "family": "bars",
  "source": "shape-editor",
  "displayName": "U bar",
  "data": {
    "shapeId": "bar-u",
    "sides": [350, 1200, 350],
    "angles": [90, 90],
    "diameter": 12,
    "quantity": 10
  },
  "calculated": {
    "totalLengthMm": 19000,
    "singleUnitLengthMm": 1900,
    "weightKg": 16.89,
    "bendCount": 2
  },
  "machineOutput": {
    "family": "bars",
    "type": "polyline_bar",
    "diameter": 12,
    "quantity": 10,
    "segments": [
      { "index": 1, "lengthMm": 350, "bendAfterDeg": 90 },
      { "index": 2, "lengthMm": 1200, "bendAfterDeg": 90 },
      { "index": 3, "lengthMm": 350, "bendAfterDeg": null }
    ],
    "totalLengthMm": 19000,
    "bendCount": 2
  },
  "validation": {
    "valid": true,
    "errors": []
  }
}
```

### Calculated Fields

| Field | Formula |
|---|---|
| `singleUnitLengthMm` | `sum(sides)` |
| `totalLengthMm` | `sum(sides) * quantity` |
| `bendCount` | `angles.length` |
| `weightKg` | `(singleUnitLengthMm / 1000) * kgPerMeter(diameter) * quantity` |

Required calculated fields:

- `totalLengthMm`
- `weightKg`
- `bendCount`

### Validation Rules

- `family === "bars"`.
- `sides` is a non-empty array.
- Every `sides[]` value is finite and `> 0`.
- `angles.length === sides.length - 1`.
- Every `angles[]` value is finite and between `-360` and `360`.
- `diameter > 0`.
- `quantity` is an integer and `> 0`.
- Bars must not use mesh fields: `length`, `width`, `longitudinalSpacing`, `transverseSpacing`, `edgeLeft`, `edgeRight`, `edgeTop`, `edgeBottom`.
- Bars must not use pile fields: `pileDiameter`, `pileLength`, `longitudinalBars`, `spiralDiameter`, `spiralZones`.

### Machine Output Fields

Machine output is a structured future export only. It is not BVBS yet and not a machine command.

Required fields:

- `family`
- `type`
- `diameter`
- `quantity`
- `segments[]`
- `segments[].index`
- `segments[].lengthMm`
- `segments[].bendAfterDeg`
- `totalLengthMm`
- `bendCount`

### Fields Used By Orders/Items

Orders/Items store:

- `family`
- `displayName`
- `data.sides`
- `data.angles`
- `data.diameter`
- `data.quantity`
- `calculated.totalLengthMm`
- `calculated.weightKg`
- `calculated.bendCount`
- full approved shape snapshot

### Fields Used By Production Cards

Production cards use:

- `family`
- `displayName`
- `sides`
- `angles`
- `diameter`
- `quantity`
- `totalLengthMm`
- `weightKg`
- `bendCount`

### Fields Used By Pricing / Weight Calculation

Pricing and weight calculation use:

- `diameter`
- `quantity`
- `singleUnitLengthMm`
- `totalLengthMm`
- `weightKg`
- `bendCount` when pricing has bend labor rules

## 2. mesh

Mesh only. Mesh does not use `sides[]` or `angles[]`.

### User Fields

The Shape Editor must collect or receive:

| Field | Type | Required | Description |
|---|---|---:|---|
| `length` | number | yes | Overall mesh length. |
| `width` | number | yes | Overall mesh width. |
| `longitudinalDiameter` | number | yes | Diameter of longitudinal bars. |
| `longitudinalSpacing` | number | yes | Spacing between longitudinal bars. |
| `transverseDiameter` | number | yes | Diameter of transverse bars. |
| `transverseSpacing` | number | yes | Spacing between transverse bars. |
| `edgeLeft` | number | yes | Left edge offset. Use `0` if none. |
| `edgeRight` | number | yes | Right edge offset. Use `0` if none. |
| `edgeTop` | number | yes | Top edge offset. Use `0` if none. |
| `edgeBottom` | number | yes | Bottom edge offset. Use `0` if none. |
| `quantity` | integer | no | If not returned by the editor, Orders own item quantity. |

### Saved JSON

```json
{
  "contractVersion": 1,
  "family": "mesh",
  "source": "shape-editor",
  "displayName": "Mesh 600x250 ?8@20 / ?8@20",
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
    "edgeBottom": 0,
    "quantity": 1
  },
  "calculated": {
    "longitudinalBarCount": 31,
    "transverseBarCount": 14,
    "longitudinalTotalLengthMm": 7750,
    "transverseTotalLengthMm": 8400,
    "totalLengthMm": 16150,
    "weightKg": 6.38
  },
  "machineOutput": {
    "family": "mesh",
    "type": "mesh_grid",
    "length": 600,
    "width": 250,
    "longitudinalDiameter": 8,
    "longitudinalSpacing": 20,
    "longitudinalBarCount": 31,
    "transverseDiameter": 8,
    "transverseSpacing": 20,
    "transverseBarCount": 14,
    "edges": {
      "left": 0,
      "right": 0,
      "top": 0,
      "bottom": 0
    },
    "totalLengthMm": 16150
  },
  "validation": {
    "valid": true,
    "errors": []
  }
}
```

### Calculated Fields

| Field | Formula |
|---|---|
| `longitudinalBarCount` | Count of bars placed across `length` using `longitudinalSpacing` and left/right edges. |
| `transverseBarCount` | Count of bars placed across `width` using `transverseSpacing` and top/bottom edges. |
| `longitudinalTotalLengthMm` | `longitudinalBarCount * width` |
| `transverseTotalLengthMm` | `transverseBarCount * length` |
| `totalLengthMm` | `longitudinalTotalLengthMm + transverseTotalLengthMm` multiplied by `quantity` if present. |
| `weightKg` | Longitudinal weight plus transverse weight, each using its own diameter. |

Required calculated fields:

- `longitudinalBarCount`
- `transverseBarCount`
- `totalLengthMm`
- `weightKg`

### Validation Rules

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
- `quantity`, if present, must be an integer and `> 0`.
- Mesh must not contain `sides` or `angles`.
- Changing spacing changes only bar counts/positions and derived length/weight.
- Changing diameter changes only bar thickness/weight, not bar count.

### Machine Output Fields

Machine output is a structured future export only. It is not BVBS yet and not a machine command.

Required fields:

- `family`
- `type`
- `length`
- `width`
- `longitudinalDiameter`
- `longitudinalSpacing`
- `longitudinalBarCount`
- `transverseDiameter`
- `transverseSpacing`
- `transverseBarCount`
- `edges.left`
- `edges.right`
- `edges.top`
- `edges.bottom`
- `totalLengthMm`

### Fields Used By Orders/Items

Orders/Items store:

- `family`
- `displayName`
- `data.length`
- `data.width`
- `data.longitudinalDiameter`
- `data.longitudinalSpacing`
- `data.transverseDiameter`
- `data.transverseSpacing`
- `data.edgeLeft`
- `data.edgeRight`
- `data.edgeTop`
- `data.edgeBottom`
- `data.quantity` if supplied
- `calculated.longitudinalBarCount`
- `calculated.transverseBarCount`
- `calculated.totalLengthMm`
- `calculated.weightKg`
- full approved shape snapshot

### Fields Used By Production Cards

Production cards use:

- `family`
- `displayName`
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
- `weightKg`

### Fields Used By Pricing / Weight Calculation

Pricing and weight calculation use:

- `longitudinalDiameter`
- `longitudinalBarCount`
- `width`
- `transverseDiameter`
- `transverseBarCount`
- `length`
- `totalLengthMm`
- `weightKg`
- `quantity` from editor or Orders item

## 3. piles

Pile cage / column cage only. Piles do not use `sides[]` or `angles[]`.

### User Fields

The Shape Editor must collect or receive:

| Field | Type | Required | Description |
|---|---|---:|---|
| `pileDiameter` | number | yes | Cage/pile diameter. |
| `pileLength` | number | yes | Total pile cage length. |
| `longitudinalBars` | integer | yes | Number of longitudinal bars around circumference. |
| `longitudinalDiameter` | number | yes | Diameter of longitudinal bars. |
| `spiralDiameter` | number | yes | Spiral bar diameter. |
| `spiralZones` | array | yes | Ordered zones along pile length. |
| `quantity` | integer | no | If not returned by the editor, Orders own item quantity. |

`spiralZones[]` fields:

| Field | Type | Required | Description |
|---|---|---:|---|
| `name` | string | yes | Zone label, for example `Zone A`. |
| `length` | number | yes | Zone length. |
| `pitch` | number | yes | Spiral pitch in this zone. |

### Saved JSON

```json
{
  "contractVersion": 1,
  "family": "piles",
  "source": "shape-editor",
  "displayName": "Pile ?70 L=2200 26?22",
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
    ],
    "quantity": 1
  },
  "calculated": {
    "totalLongitudinalLengthMm": 57200,
    "totalSpiralLengthMm": 35647,
    "totalLengthMm": 92847,
    "weightKg": 175.2
  },
  "machineOutput": {
    "family": "piles",
    "type": "pile_cage",
    "pileDiameter": 70,
    "pileLength": 2200,
    "longitudinalBars": 26,
    "longitudinalDiameter": 22,
    "spiralDiameter": 8,
    "spiralZones": [
      { "name": "Zone A", "startMm": 0, "length": 70, "pitch": 10 },
      { "name": "Zone B", "startMm": 70, "length": 200, "pitch": 20 },
      { "name": "Zone C", "startMm": 270, "length": 1350, "pitch": 20 }
    ],
    "totalLongitudinalLengthMm": 57200,
    "totalSpiralLengthMm": 35647
  },
  "validation": {
    "valid": true,
    "errors": []
  }
}
```

### Calculated Fields

| Field | Formula |
|---|---|
| `totalLongitudinalLengthMm` | `pileLength * longitudinalBars` multiplied by `quantity` if present. |
| `spiral zone turn count` | `ceil(zone.length / zone.pitch)` for calculation only. |
| `spiral zone length` | Helical length approximation using pile circumference and pitch. Exact machine adapter may refine later. |
| `totalSpiralLengthMm` | Sum of spiral zone lengths multiplied by `quantity` if present. |
| `totalLengthMm` | `totalLongitudinalLengthMm + totalSpiralLengthMm` |
| `weightKg` | Longitudinal steel weight plus spiral steel weight, each using its own diameter. |

Required calculated fields:

- `totalLongitudinalLengthMm`
- `totalSpiralLengthMm`
- `weightKg`

### Validation Rules

- `family === "piles"`.
- `pileDiameter > 0`.
- `pileLength > 0`.
- `longitudinalBars` is an integer and `>= 3`.
- `longitudinalDiameter > 0`.
- `spiralDiameter > 0`.
- `spiralZones` is a non-empty array.
- Every zone has non-empty `name`.
- Every zone has `length > 0`.
- Every zone has `pitch > 0`.
- Sum of `spiralZones[].length` must be `<= pileLength`.
- `quantity`, if present, must be an integer and `> 0`.
- Piles must not contain `sides` or `angles`.
- Changing one zone pitch changes only that zone's spiral density and derived spiral length/weight.
- Changing `longitudinalBars` changes only longitudinal count/weight and top-view count.

### Machine Output Fields

Machine output is a structured future export only. It is not BVBS yet and not a machine command.

Required fields:

- `family`
- `type`
- `pileDiameter`
- `pileLength`
- `longitudinalBars`
- `longitudinalDiameter`
- `spiralDiameter`
- `spiralZones[]`
- `spiralZones[].name`
- `spiralZones[].startMm`
- `spiralZones[].length`
- `spiralZones[].pitch`
- `totalLongitudinalLengthMm`
- `totalSpiralLengthMm`

### Fields Used By Orders/Items

Orders/Items store:

- `family`
- `displayName`
- `data.pileDiameter`
- `data.pileLength`
- `data.longitudinalBars`
- `data.longitudinalDiameter`
- `data.spiralDiameter`
- `data.spiralZones`
- `data.quantity` if supplied
- `calculated.totalLongitudinalLengthMm`
- `calculated.totalSpiralLengthMm`
- `calculated.weightKg`
- full approved shape snapshot

### Fields Used By Production Cards

Production cards use:

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

### Fields Used By Pricing / Weight Calculation

Pricing and weight calculation use:

- `pileLength`
- `longitudinalBars`
- `longitudinalDiameter`
- `spiralDiameter`
- `spiralZones[].length`
- `spiralZones[].pitch`
- `totalLongitudinalLengthMm`
- `totalSpiralLengthMm`
- `weightKg`
- `quantity` from editor or Orders item

## Acceptance Rules For Shape Editor Approval

Before `onSelect` / approval returns to Orders/Items:

1. Validate the family-specific payload.
2. Calculate all required calculated fields.
3. Build the future-ready `machineOutput` object.
4. Return the full contract envelope.
5. Do not return only drawing data.
6. Do not return only `sides/angles` for mesh or piles.
7. Do not implement BVBS in this contract.
8. Do not send anything to a machine in this contract.

## Explicit Non-Goals

- No new shapes.
- No BVBS generation.
- No live machine integration.
- No UI layout contract.
- No rendering contract.
- No pricing rules beyond the fields needed for pricing and weight calculation.
