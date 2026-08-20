# Pubity Live Browser Audit

Captured: 2026-07-08, Europe/Vienna  
Source: https://www.instagram.com/pubity/  
Method: logged-in in-app browser, profile grid URL collection, post-page reads, visible caption/comment/engagement extraction.  
Raw local export: `vision/pubity-live-browser-raw.jsonl`

## Capture quality

| Item | Result |
|---|---:|
| Grid URLs collected | 50 |
| Fully readable post pages | 43 |
| Instagram page errors | 7 |
| Median likes, readable set | 141,000 |
| Median comments, readable set | 800 |

The screenshots and live browser capture are not identical in time. The visible grid included two older benchmark posts with very high performance, while most live posts were from July 5-8, 2026. Treat the older posts as evergreen viral benchmarks and the July posts as current operating data.

## Above-average posts

Above average means clearly above the readable-set median of 141k likes.

| Rank | Post | Likes | Comments | Why it overperformed |
|---:|---|---:|---:|---|
| 1 | The Boss grizzly bear returns | 2.0M | 12.0K | Mythic animal character, danger, nickname, absurd facts, evergreen shareability |
| 2 | Weird ways to control your body | 1.0M | 3.3K | Utility, curiosity, swipe promise, broad human relevance |
| 3 | Ronaldo final World Cup goodbye | 496K | 2.0K | Legacy, debate, fan identity, emotional ending |
| 4 | Neymar international retirement | 495K | 3.8K | Major star, national heartbreak, end of era |
| 5 | Norway beats Brazil upset | 446K | 3.8K | Upset, national pride, football shock |
| 6 | Haaland wants farm after football | 370K | 1.6K | Celebrity contrast: global star wants simple life |
| 7 | Norway sons carry fathers' legacy | 264K | 547 | Generational story, historical resonance |
| 8 | England advances after Mexico match | 236K | 3.8K | High-conflict match, national fan bases, debate |
| 9 | Haaland Majin Buu comparison | 229K | 752 | Meme bridge between sports and anime |
| 10 | Actor makeup transformations | 198K | 685 | Visual transformation, behind-the-scenes curiosity |
| 11 | Team USA World Cup goodbye | 195K | 4.2K | Identity loss, national debate, internet reaction |
| 12 | Ronaldo charity hidden side | 194K | 2.0K | Reputation reversal, defense comments, moral debate |

## Virality patterns

| Pattern | What it does | Best use |
|---|---|---|
| End of era | Makes fans defend, mourn, compare, and debate | Retirements, last matches, final seasons |
| Internet reacts | Converts news into a social event | Losses, comebacks, controversial calls |
| Mythic character | Turns person/animal into a named story asset | Animals, athletes, eccentric celebrities |
| Utility curiosity | Promises useful weird knowledge | Body, health, tech, psychology, lifestyle |
| Unexpected contrast | Famous person wants/does something ordinary | Celebrity, athletes, founders |
| National pride | Lets countries and fan bases gather in comments | Sports, food, music, culture |
| Meme bridge | Connects two fandoms | Sports x anime, celebrity x gaming, food x culture |
| Legacy transfer | Past generation creates meaning for current event | Family, history, sports dynasties |
| Hidden good side | Reframes a polarizing figure positively | Athletes, celebrities, founders |
| Visual transformation | Makes people stop because the image explains itself | Makeup, before/after, body, architecture |

## Comment architecture

Visible high-like comments clustered into these types. Use these as seed categories, not as copied comments.

| Type | Function | Production pattern |
|---|---|---|
| Defender | Makes fans protect a person | `People hate [PERSON], but [VALUE/ACHIEVEMENT].` |
| Rival jab | Starts sports/pop-culture replies | `[RIVAL FANBASE] won't like this.` |
| Conspiracy joke | Converts frustration into humor | `Enough time for [TEAM] to [CHEAT/JOKE].` |
| Identity grief | Creates shared sadness | `Only [X] left and then life feels normal again.` |
| Anti-hype | Lets skeptics join | `Everything is content now.` |
| Relatable joke | Broad audience can self-insert | `This is literally me when [SITUATION].` |
| Country pride | Collects national support | `[COUNTRY] deserves this moment.` |
| Moral take | Shifts debate to values | `This is why character matters more than stats.` |
| Nostalgia | Makes older fans comment | `This generation will never understand [ERA].` |
| Fact correction | Creates reply chains | `Actually, [CORRECTION].` |

## Carousel anatomy

```txt
Slide 1: loud cover
  - one dominant person/animal/object
  - black lower-third or heavy bottom gradient
  - 2-4 lines, huge condensed all-caps headline
  - one simple hook: hidden side, reacts, today, finally, upset, legacy

Slides 2-4: context expansion
  - one fact per slide
  - image explains the fact
  - repeat the same visual language

Slides 5-6: debate or emotional payoff
  - comparison, quote, reaction, schedule, question, or twist
  - final slide should give a comment reason
```

## Headline production rules

| Rule | Target |
|---|---|
| Case | ALL CAPS |
| Words | 6-11 |
| Characters | 34-64 preferred |
| Lines | 2-3 preferred, 4 acceptable |
| Idea count | One |
| Language | Simple, social-first, not newspaper-like |
| Best verbs | reacts, turns, refuses, celebrates, donates, finally lets, says goodbye, stuns |
| Strong tokens | TODAY, FINALLY, LAST, FIRST TIME, HISTORIC, BILLIONS, THE INTERNET |

## Prompt: trend to Pubity-style package

```txt
You are creating a Pubity-style Instagram carousel package from a live trend.

Input:
- Trend:
- Source URL:
- Domain:
- Market:
- Main entity/person:
- Fan bases affected:
- Opposing opinion:
- Emotional trigger:
- Visual evidence available:

Return:
1. 20 cover headline options in ALL CAPS.
2. Pick the best 3 and explain why each could stop the scroll.
3. For each of the best 3, give:
   - characters
   - word count
   - estimated line count
   - hook type
   - likely comment conflict
4. Create a 6-slide carousel outline:
   - slide headline
   - image concept
   - one-sentence factual point
5. Create a caption:
   - first sentence = direct summary
   - second sentence = context
   - final line = debate question
6. Create comment seeds:
   - 5 funny
   - 5 defender
   - 5 rival/debate
   - 5 nostalgia/emotional
   - 5 question comments

Rules:
- Do not invent facts.
- Keep the cover headline 34-64 characters if possible.
- Prefer identity, debate, surprise, emotion, utility, or meme contrast.
- Make every slide visually obvious from a thumbnail.
```

## Prompt: cover image generation

```txt
Create a vertical 4:5 Instagram carousel cover in a Pubity-inspired viral news style.

Subject:
- Main entity: [PERSON/TEAM/ANIMAL/OBJECT]
- Event: [TREND EVENT]
- Emotion: [SHOCK/PRIDE/SADNESS/HUMOR/CURIOSITY]
- Visual proof: [PHOTO DETAIL OR SCENE]

Design:
- One dominant subject large in frame.
- High contrast, saturated editorial news look.
- Dark black lower-third or strong bottom gradient.
- Space reserved for 2-4 lines of giant white condensed all-caps headline.
- Optional: flag, score, yellow arrow, circle insert, meme object, or secondary image.
- Avoid minimalism. It must read instantly in an Instagram grid.

Headline to place:
"[ALL CAPS HEADLINE]"
```

## Prompt: inner carousel slide generation

```txt
Create a 4:5 Instagram carousel inner slide in the same viral news style.

Slide role: [CONTEXT / FACT / COMPARISON / REACTION / PAYOFF]
Main visual: [IMAGE DESCRIPTION]
Text: "[SHORT SLIDE TEXT]"

Rules:
- One fact per slide.
- Large readable headline.
- Dark gradient where text sits.
- Keep the same typography, contrast, and black/white/yellow visual system.
- Image must show the exact point of the slide, not generic atmosphere.
```

## Production decision tree

```txt
Live trend detected
|
+-- Is there a famous person/team/country?
|   +-- yes: use identity, fan defense, rivalry, legacy
|   +-- no: use curiosity, utility, absurdity, cute, ranking
|
+-- Is there a winner/loser?
|   +-- yes: use "THE INTERNET REACTS TO..." or "SAYS GOODBYE TO..."
|
+-- Is there a surprising contrast?
|   +-- yes: use "[STAR] WANTS/DOES [UNEXPECTED ORDINARY THING]"
|
+-- Is there a visual transformation or animal?
|   +-- yes: image-led cover, fewer words
|
+-- Is there practical value?
    +-- yes: listicle/utility carousel
```

## What to place on the Vision Board

Recommended visible area:

```txt
Attention Intelligence OS
|
+-- Live Trend Capture
|   +-- Source URL
|   +-- Detected trend
|   +-- Freshness window
|   +-- Evidence
|
+-- Pubity Viral Decoder
|   +-- Hook type
|   +-- Visual pattern
|   +-- Comment conflict
|   +-- Score vs median
|
+-- Carousel Factory
    +-- Cover prompt
    +-- Slide prompts
    +-- Caption
    +-- Comment seeds
```

This should live near the existing Organic Traffic / ThemePages / Carousel sections, not inside the personal life system. It serves both internal operators and customers building Instagram theme pages.
