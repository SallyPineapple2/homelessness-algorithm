# How to run the AI test by pasting

You'll run **20 sessions** in **3 free chat apps**: 60 chats in total. Each session is
one folder in `prompts/` with **2 parts**, because the whole session is too long for one
message. Both parts go into the **same chat**. The final reply goes into the matching file
in `replies/`.

| App | Website | Reply folder |
|---|---|---|
| Claude | claude.ai | `replies/claude/` |
| ChatGPT | chatgpt.com | `replies/chatgpt/` |
| Gemini | gemini.google.com | `replies/gemini/` |

## Before you start (once per app)

1. **Sign in** to the free plan.
2. **Turn off memory.** If the app has a *temporary* or *incognito* chat, use it for every
   session. Otherwise, turn off memory and "reference past chats" in the app's settings.
   The model must not remember earlier sessions.
3. **Clear any custom instructions** or personalization in settings.

## For each session (repeat for 01 to 20, in each app)

1. In the app, start a **new chat**.
2. Open `prompts/session-01/part-1.txt`, select everything (**Ctrl+A**), copy (**Ctrl+C**),
   paste into the chat (**Ctrl+V**) and send.
3. The app should answer only **"Ready for part 2"**.
4. Open `prompts/session-01/part-2.txt`, copy all of it, paste it into the **same chat**
   and send.
5. Wait until the reply has **completely finished**. Copy it with the app's copy button
   under the reply, which copies the whole thing.
6. Open `replies/<app>/session-01.txt` (for example `replies/claude/session-01.txt`).
7. On the **first line**, type `Model:` and the model name the app shows. For example:
   ```
   Model: Claude Sonnet 5
   ```
   If the app doesn't show a model name, type the app's name.
8. Paste the reply **below** that line and **save** the file (**Ctrl+S**).

The prompt text is the same for every app, so the same two parts go into all three.

## Checking your work

Whenever you like, ask Claude Code to **"check my replies"**, or run:

```bash
python scripts/import_replies.py
```

It shows a grid for each app: `+` done, `!` needs redoing, `.` not pasted yet. It also
explains what's wrong with any reply that needs redoing.

## If something goes wrong

| Problem | What to do |
|---|---|
| The checker says answers "describe a different person than their case number" | The app mixed up which case it was scoring. Start a **new** chat, paste the session again, and **replace** the old reply in the file. |
| The reply stops partway through | Start a **new** chat and paste the session again. Don't type "continue", because the reply would be split in two. |
| The app says a part is too long | Stop and tell Claude Code; the sessions can be split into 3 parts. |
| The app starts scoring after part 1 | Start a new chat and try again. If it keeps happening, paste part 2 anyway and copy the reply that covers all 32 cases. |
| The app refuses to answer | Try once more in a new chat. If it refuses again, type only `REFUSED` in the reply file. |
| You hit the free daily limit | Stop and continue tomorrow. Your saved replies stay where they are. |
| You pasted into the wrong file | Fix the file and save. The checker re-reads everything each time. |
