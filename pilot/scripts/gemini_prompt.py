"""
The prompt Gemini sees for one profile, and the check on its reply.

Gemini is asked for its own judgment of housing priority. It is never shown the
VI-SPDAT questions, indicators, scoring rules, or score, and is not asked to
reproduce them. The three categories are defined by the kind of help the person
needs, which is what makes them comparable with VI-SPDAT's three recommendations
(Permanent Supportive Housing / Rapid Re-Housing / no housing intervention).

Every profile is sent in its own request with nothing else in it, so no earlier
profile can influence a later one.
"""

import json
import re

CATEGORIES = ("High", "Medium", "Low")

SECTION_TITLES = [
    ("background", "Work and education"),
    ("path", "Path into homelessness"),
    ("housing", "Current housing"),
    ("finances", "Finances"),
    ("health", "Health"),
    ("safety", "Safety"),
    ("ties", "Family and social ties"),
    ("routine", "A typical day"),
    ("goals", "Goals"),
    ("services", "Service history"),
    ("demeanor", "Presentation in the interview"),
]

INSTRUCTIONS = (
    "You are helping a homeless services agency decide who should be prioritized for housing "
    "assistance. Below is a case summary written by intake staff. Using your own judgment, decide "
    "how high a priority this person should be for housing assistance.\n\n"
    "Choose exactly one priority category:\n"
    "- High: needs intensive, long-term help, such as permanent housing with ongoing support "
    "services, and should be among the first people offered housing.\n"
    "- Medium: needs time-limited help, such as short-term rental assistance and help finding a "
    "place, to get back into housing.\n"
    "- Low: likely to get back into housing with little or no help from the agency at this time.\n\n"
    "Base your judgment only on the information in the case summary."
)

REPLY_FORMAT = (
    "Reply with JSON only, and no other text, in exactly this format:\n"
    '{"priority": "High" or "Medium" or "Low", "explanation": "<one or two sentences>"}'
)


def case_text(profile):
    lines = ["Case summary", profile["demographic_line"], ""]
    for key, title in SECTION_TITLES:
        lines.append(f"{title}: {profile['narrative'][key]}")
    return "\n".join(lines)


def prompt(profile):
    return "\n\n".join([INSTRUCTIONS, case_text(profile), REPLY_FORMAT]) + "\n"


def parse_reply(text):
    """(priority, explanation, problems). A reply is valid only with exactly one known category."""
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    body = fence.group(1) if fence else text[text.find("{"):text.rfind("}") + 1]
    try:
        data = json.loads(body)
    except ValueError:
        return None, None, ["reply is not readable JSON"]
    if not isinstance(data, dict):
        return None, None, ["reply is not a JSON object"]
    priority = str(data.get("priority", "")).strip().capitalize()
    explanation = data.get("explanation")
    problems = []
    if priority not in CATEGORIES:
        problems.append(f"priority {data.get('priority')!r} is not High, Medium, or Low")
    if not isinstance(explanation, str) or not explanation.strip():
        problems.append("no explanation")  # secondary; recorded but does not void the category
    return (priority if priority in CATEGORIES else None), explanation, problems
