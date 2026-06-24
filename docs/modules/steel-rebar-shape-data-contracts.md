# Steel Rebar Shape Data Contracts

Source of truth for shape data only. This document does not define UI layout, preview rendering, or order screens.

Families:

- `bars` - simple polyline bar shapes. Uses `sides[]` and `angles[]`.
- `mesh` - welded/assembled mesh. Does not use `sides[]` or `angles[]`.
- `piles` - pile cage / column cage. Does not use `sides[]` or `angles[]`.

All lengths, diameters, spacing, pitch, and edge offsets are stored in millimeters unless explicitly stated otherwise.

## Shared Storage Model

### Database Schema

Use one canonical shape definition table. Family-specific payload is stored in JSON so Orders, Production Cards, OCR, and machine export all read the same snapshot.

```sql
CREATE TABLE steel_rebar_shape_definitions (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL CHECK (family IN ('bars', 'mesh', 'piles')),
  name TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  machine_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);
```

Order items must store an immutable snapshot, not just a reference to a live saved shape:

```sql
ALTER TABLE order_items ADD COLUMN shape_family TEXT CHECK (shape_family IN ('bars', 'mesh', 'piles'));
ALTER TABLE order_items ADD COLUMN shape_payload_json TEXT;
ALTER TABLE order_items ADD COLUMN shape_machine_json TEXT;
ALTER TABLE order_items ADD COLUMN shape_contract_version INTEGER NOT NULL DEFAULT 1;
```

Rules:

- `shape_family` and `payload_json.family` must match.
- `payload_json.version` is the contract version for validation and migrations.
- `machine_json` is derived from `payload_json`; it is cached only for traceability and must be regenerated if payload changes.
- Orders, Production, Pricing, and OCR must not invent alternate shape payloads.

## Family: bars

Simple bar shapes only: straight bars, L shapes, U shapes, stirrups, and regular bent bars.

### 1. Database Schema

Stored in `steel_rebar_shape_definitions.payload_json` and copied to `order_items.shape_payload_json`.

Required JSON fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `version` | integer | yes | Current value: `1`. |
| `family` | string | yes | Must be `bars`. |
| `shapeId` | string | no | Preset/custom identifier. |
| `name` | string | no | User label; not used for validation. |
| `diameterMm` | number | yes | Main bar diameter. |
| `sides` | number[] | yes | Side lengths in bending path order. |
| `angles` | number[] | yes | Bend angles between sides. Length is `sides.length - 1`. |
| `is3d` | boolean/integer | no | True only when shape leaves the plane. |
| `azAngles` | number[]/null | no | Real 3D turns per segment when `is3d` is true. |
| `elAngles` | number[]/null | no | Real 3D elevation per segment when `is3d` is true. |
| `metadata` | object | no | Non-machine notes only. |

### 2. Saved JSON Format

```json
{
  "version": 1,
  "family": "bars",
  "shapeId": "bar-u-001",
  "name": "custom bar",
  "diameterMm": 12,
  "sides": [350, 1200, 350],
  "angles": [90, 90],
  "is3d": false,
  "azAngles": null,
  "elAngles": null,
  "metadata": {
    "source": "shape-editor"
  }
}
```

### 3. Machine Output Format

```json
{
  "version": 1,
  "family": "bars",
  "machineType": "polyline_bar",
  "diameterMm": 12,
  "segments": [
    { "index": 1, "lengthMm": 350, "bendAfterDeg": 90 },
    { "index": 2, "lengthMm": 1200, "bendAfterDeg": 90 },
    { "index": 3, "lengthMm": 350, "bendAfterDeg": null }
  ],
  "totalCutLengthMm": 1900,
  "bvbs": {
    "shapeCode": null,
    "geometry": "350/90/1200/90/350"
  }
}
```

Machine rules:

- `segments[i].lengthMm` comes from `sides[i]`.
- `segments[i].bendAfterDeg` comes from `angles[i]` or `null` for the final side.
- 3D fields are exported only to machines that support 3D geometry; otherwise validation must block machine export.

### 4. Validation Rules

- `family === 'bars'`.
- `sides` is a non-empty array.
- Every side length is finite and `> 0`.
- `angles.length === max(0, sides.length - 1)`.
- Every angle is finite and between `-360` and `360`.
- `diameterMm > 0`.
- If `is3d` is false, `azAngles` and `elAngles` are ignored or stored as `null`.
- If `is3d` is true, `azAngles.length === sides.length` and `elAngles.length === sides.length`.
- Bars payload must not contain mesh-only fields: `length`, `width`, `longitudinalSpacing`, `transverseSpacing`, `spiralZones`.

## Family: mesh

Mesh only. It does not use `sides[]` or `angles[]`.

### 1. Database Schema

Stored in `steel_rebar_shape_definitions.payload_json` and copied to `order_items.shape_payload_json`.

Required JSON fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `version` | integer | yes | Current value: `1`. |
| `family` | string | yes | Must be `mesh`. |
| `shapeId` | string | no | Preset/custom identifier. |
| `name` | string | no | User label. |
| `lengthMm` | number | yes | Overall mesh length. |
| `widthMm` | number | yes | Overall mesh width. |
| `longitudinalDiameterMm` | number | yes | Diameter of longitudinal bars. |
| `longitudinalSpacingMm` | number | yes | Spacing between longitudinal bars. |
| `transverseDiameterMm` | number | yes | Diameter of transverse bars. |
| `transverseSpacingMm` | number | yes | Spacing between transverse bars. |
| `edgeLeftMm` | number | yes | Left edge offset. Use `0` if none. |
| `edgeRightMm` | number | yes | Right edge offset. Use `0` if none. |
| `edgeTopMm` | number | yes | Top edge offset. Use `0` if none. |
| `edgeBottomMm` | number | yes | Bottom edge offset. Use `0` if none. |
| `metadata` | object | no | Non-machine notes only. |

### 2. Saved JSON Format

```json
{
  "version": 1,
  "family": "mesh",
  "shapeId": "mesh-rect-001",
  "name": "600x250 mesh",
  "lengthMm": 600,
  "widthMm": 250,
  "longitudinalDiameterMm": 8,
  "longitudinalSpacingMm": 20,
  "transverseDiameterMm": 8,
  "transverseSpacingMm": 20,
  "edgeLeftMm": 0,
  "edgeRightMm": 0,
  "edgeTopMm": 0,
  "edgeBottomMm": 0,
  "metadata": {
    "source": "shape-editor"
  }
}
```

### 3. Machine Output Format

```json
{
  "version": 1,
  "family": "mesh",
  "machineType": "mesh_grid",
  "overall": {
    "lengthMm": 600,
    "widthMm": 250
  },
  "longitudinal": {
    "diameterMm": 8,
    "spacingMm": 20,
    "barCount": 31,
    "cutLengthMm": 250
  },
  "transverse": {
    "diameterMm": 8,
    "spacingMm": 20,
    "barCount": 14,
    "cutLengthMm": 600
  },
  "edgesMm": {
    "left": 0,
    "right": 0,
    "top": 0,
    "bottom": 0
  }
}
```

Machine rules:

- `longitudinal.barCount = floor((lengthMm - edgeLeftMm - edgeRightMm) / longitudinalSpacingMm) + 1`, with a final edge bar included when the exact spacing does not land on the far edge.
- `transverse.barCount = floor((widthMm - edgeTopMm - edgeBottomMm) / transverseSpacingMm) + 1`, with a final edge bar included when needed.
- Changing spacing changes only count and grid positions.
- Changing diameter changes only bar diameter/thickness and weight calculations.

### 4. Validation Rules

- `family === 'mesh'`.
- `lengthMm > 0` and `widthMm > 0`.
- All diameters are finite and `> 0`.
- All spacing values are finite and `> 0`.
- Edge offsets are finite and `>= 0`.
- `edgeLeftMm + edgeRightMm < lengthMm`.
- `edgeTopMm + edgeBottomMm < widthMm`.
- Payload must not contain `sides`, `angles`, `azAngles`, or `elAngles`.
- Mesh machine output must include both bar counts and both visible dimensions.

## Family: piles

Pile cage / column cage only. It does not use `sides[]` or `angles[]`.

### 1. Database Schema

Stored in `steel_rebar_shape_definitions.payload_json` and copied to `order_items.shape_payload_json`.

Required JSON fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `version` | integer | yes | Current value: `1`. |
| `family` | string | yes | Must be `piles`. |
| `shapeId` | string | no | Preset/custom identifier. |
| `name` | string | no | User label. |
| `pileDiameterMm` | number | yes | Outside cage/pile diameter. |
| `pileLengthMm` | number | yes | Overall pile cage length. |
| `longitudinalBarCount` | integer | yes | Number of longitudinal bars. |
| `longitudinalDiameterMm` | number | yes | Diameter of longitudinal bars. |
| `spiralDiameterMm` | number | yes | Spiral/stirrup bar diameter. |
| `spiralZones` | array | yes | One or more pitch zones. |
| `metadata` | object | no | Non-machine notes only. |

`spiralZones[]` fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `name` | string | yes | Example: `Zone A`. |
| `lengthMm` | number | yes | Zone length along pile. |
| `pitchMm` | number | yes | Spiral pitch in the zone. |

### 2. Saved JSON Format

```json
{
  "version": 1,
  "family": "piles",
  "shapeId": "pile-round-001",
  "name": "round pile cage",
  "pileDiameterMm": 70,
  "pileLengthMm": 2200,
  "longitudinalBarCount": 26,
  "longitudinalDiameterMm": 22,
  "spiralDiameterMm": 8,
  "spiralZones": [
    { "name": "Zone A", "lengthMm": 70, "pitchMm": 10 },
    { "name": "Zone B", "lengthMm": 200, "pitchMm": 20 },
    { "name": "Zone C", "lengthMm": 1350, "pitchMm": 20 }
  ],
  "metadata": {
    "source": "shape-editor"
  }
}
```

### 3. Machine Output Format

```json
{
  "version": 1,
  "family": "piles",
  "machineType": "pile_cage",
  "pile": {
    "diameterMm": 70,
    "lengthMm": 2200
  },
  "longitudinal": {
    "barCount": 26,
    "diameterMm": 22,
    "cutLengthMm": 2200,
    "layout": "equal_around_circumference"
  },
  "spiral": {
    "diameterMm": 8,
    "zones": [
      { "name": "Zone A", "startMm": 0, "lengthMm": 70, "pitchMm": 10, "turnCount": 7 },
      { "name": "Zone B", "startMm": 70, "lengthMm": 200, "pitchMm": 20, "turnCount": 10 },
      { "name": "Zone C", "startMm": 270, "lengthMm": 1350, "pitchMm": 20, "turnCount": 68 }
    ]
  }
}
```

Machine rules:

- Zone order is machine order from pile start to pile end.
- `startMm` is derived from the cumulative length of preceding zones.
- `turnCount = ceil(lengthMm / pitchMm)` unless a machine-specific adapter requires exact end handling.
- Changing one zone pitch changes only that zone's `turnCount` and spiral positions.
- Longitudinal bars are equal around circumference unless `layout` is extended in a future contract version.

### 4. Validation Rules

- `family === 'piles'`.
- `pileDiameterMm > 0` and `pileLengthMm > 0`.
- `longitudinalBarCount` is an integer and `>= 3`.
- `longitudinalDiameterMm > 0`.
- `spiralDiameterMm > 0`.
- `spiralZones` is a non-empty array.
- Every zone has a non-empty `name`, `lengthMm > 0`, and `pitchMm > 0`.
- Sum of `spiralZones.lengthMm` must be `<= pileLengthMm`; if shorter, the remaining length is an unspiraled tail and must be explicit in machine output metadata.
- Payload must not contain `sides`, `angles`, `azAngles`, or `elAngles`.
- Pile machine output must include both top-view data (`longitudinal.barCount`) and side-view data (`spiral.zones`).

## Migration And Compatibility

Current runtime field aliases may exist in older saved data. Normalization must map them into this contract before validation:

| Runtime alias | Contract field |
|---|---|
| `length` | `lengthMm` for mesh only |
| `width` | `widthMm` for mesh only |
| `longitudinalDiameter` | `longitudinalDiameterMm` |
| `longitudinalSpacing` | `longitudinalSpacingMm` |
| `transverseDiameter` | `transverseDiameterMm` |
| `transverseSpacing` | `transverseSpacingMm` |
| `edgeLeft` / `edgeRight` / `edgeTop` / `edgeBottom` | `edgeLeftMm` / `edgeRightMm` / `edgeTopMm` / `edgeBottomMm` |
| `pileDiameter` | `pileDiameterMm` |
| `pileLength` | `pileLengthMm` |
| `longitudinalBars` | `longitudinalBarCount` |
| `spiralDiameter` | `spiralDiameterMm` |
| `spiralZones[].length` | `spiralZones[].lengthMm` |
| `spiralZones[].pitch` | `spiralZones[].pitchMm` |

Normalization rules:

- Accept aliases only at import/load boundaries.
- Save and machine export must use the contract field names.
- Do not infer family from field presence when `family` is missing; reject the payload and ask for correction.
- Do not mutate historical order snapshots during normalization; create a normalized copy for processing.
