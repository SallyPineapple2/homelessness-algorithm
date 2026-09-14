# Archived attempts

Earlier replies that were replaced, kept as evidence. Nothing in here is used in the
bias analysis; it documents what each app returned before a session was redone.

| Folder | What happened |
|---|---|
| `chatgpt/attempt-1/` | ChatGPT's first 20 sessions (2026-09-13). The case-label check found 208 of 640 answers (33%) described a different person than their case number, in 14 of 20 sessions. Those 14 sessions were redone. |

Each attempt holds `replies/` (exactly as pasted), `raw/` (the imported records, including
the case-label counts), and `case_labels.csv` (every answer beside the case it was labeled with).
| `gemini/two-part-pilot/` | Gemini's first two sessions (2026-09-13), sent through the API as two messages in one chat, like the ChatGPT pastes. The run then switched to one unsplit message per session so all 20 fit the free tier's daily request limit, and these two sessions were redone that way. |
