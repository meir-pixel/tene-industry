# Factory Order Intake Merge

## Source Of Truth

IronBend is the only production source of truth for orders, pallets, items, and
factory statuses. The temporary standalone factory queue must not write back to
production after this merge is deployed.

## Reviewed Intake Flow

1. A manager opens the existing IronBend new-order screen.
2. The manager uploads an image or PDF.
3. `/api/analyze-image` sends the document to OpenAI from the server only.
4. IronBend shows an editable preview. Uncertain values remain visible in the
   item note and must be reviewed.
5. The manager corrects the rows and submits the existing order form.
6. IronBend writes the order, pallet, and items in one transaction.
7. Workers receive the approved items from the existing production queue.

## Collision Rule

Do not synchronize two editable order databases. WhatsApp, email, spreadsheet,
image, and PDF intake must enter through the IronBend review flow before they
create production rows.

## Render Configuration

Set these environment variables in Render before enabling document recognition:

```text
OPENAI_API_KEY=<secret>
OPENAI_MODEL=gpt-4.1-mini
INTAKE_AI_ENABLED=true
```

Keep `INTAKE_AI_ENABLED=false` until a manager has verified a staging upload and
confirmed that the recognized dimensions match the source document.

