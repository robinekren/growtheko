# Pubity Carousel Headline Playbook

Source basis:
- Provided screenshots from Instagram grid `https://www.instagram.com/pubity/`
- 31 visible carousel/grid headlines analyzed from screenshots.
- Live browser audit: `vision/pubity-live-browser-audit.md`
- Raw browser export: `vision/pubity-live-browser-raw.jsonl`

Live browser status:
- 50 Pubity grid URLs were collected in a logged-in in-app browser on 2026-07-08.
- 43 post pages were fully readable; 7 individual pages returned Instagram-side errors during extraction.
- Median of readable set: 141,000 likes and 800 comments.
- Treat posts above that median as above-average signals and posts above 190,000 likes as strong viral references.

## Quantitative headline pattern

```txt
Visible sample size: 31 headlines

Character range:
  Normal: 30-74 characters
  Strong sweet spot: 38-63 characters
  Outlier quote card: 153 characters

Word range:
  Normal: 5-12 words
  Strong sweet spot: 7-10 words
  Outlier quote card: 31 words

Line count:
  Normal: 2-3 lines
  Heavy info cards: 4 lines
  Quote cards: 5-8 lines

Recommended production constraint:
  34-64 characters
  6-11 words
  2-3 lines
  One simple idea
```

## Observed headline examples

```txt
7 WEIRD WAYS TO CONTROL YOUR BODY
"THE BOSS" HAS EMERGED FROM HIBERNATION
MOROCCAN CUISINE VOTED AS THE BEST IN THE WORLD
THERE WILL BE NO WORLD CUP MATCHES TODAY
THE WORLD CUP COULD BOOST CAPE VERDE'S TOURISM BY BILLIONS
THE SIDE OF RONALDO THE MEDIA NEVER SHOWS YOU
THE GREATEST BROMANCE OF THE WORLD CUP
MINECRAFT FINALLY LETS YOU SIT AFTER 17 YEARS
THE INTERNET REACTS TO SWITZERLAND KNOCKING OUT COLOMBIA
HASBULLA TURNS 24 TODAY
THE INTERNET REACTS TO ARGENTINA'S INCREDIBLE COMEBACK
ERLING HAALAND REACTS TO PEOPLE SAYING HE LOOKS LIKE MAJIN BUU
THIS BABY HIPPO PHOTOBOMBED A COUPLE'S PROPOSAL
ERLING HAALAND WANTS TO OWN A FARM AFTER RETIRING FROM FOOTBALL
HERE ARE THE WORLD CUP KNOCKOUT GAMES BEING PLAYED TODAY
DOG REFUSES TO BE LEFT OUT OF FAMILY PHOTO AND POSES WITH THE CUTEST SMILE
THE INTERNET REACTS TO THE USA'S WORLD CUP RUN ENDING
THE INTERNET REACTS TO RONALDO'S LAST WORLD CUP MATCH
TODAY'S DATE IS OFFICIALLY 6/7
ENGLAND PLAYERS HAVE DONATED THEIR MATCH FEES FOR 19 YEARS
THE TOP 50 SPORTS MOVIES EVERYONE SHOULD WATCH
PEOPLE FROM AROUND THE WORLD TRY ARGENTINIAN CHORIPAN FOR THE FIRST TIME
THEIR FATHERS PLAYED IN THE LAST U.S WORLD CUP NOW THEIR SONS CARRY THE LEGACY
50 CENT TURNS 51 YEARS OLD TODAY
CABO VERDE CELEBRATES TEAM'S RETURN AFTER HISTORIC WORLD CUP
```

## Headline formulas

| Formula | Use case | Template |
|---|---|---|
| Hidden side | celebrity, athlete, public figure | `THE SIDE OF [PERSON] [GROUP] NEVER SHOWS YOU` |
| Internet reacts | sports, celebrity, controversy | `THE INTERNET REACTS TO [EVENT]` |
| Today milestone | birthdays, anniversaries, dates | `[PERSON/EVENT] TURNS [NUMBER] TODAY` |
| Ranking/list | evergreen, watchable, saveable | `THE TOP [NUMBER] [CATEGORY] EVERYONE SHOULD [ACTION]` |
| Surprising fact | curiosity, human interest | `[SUBJECT] HAS [SURPRISING ACTION] FOR [TIME]` |
| Emotional animal/human | cute, shareable, family | `[ANIMAL/PERSON] REFUSES TO [ACTION] AND [EMOTIONAL RESULT]` |
| Legacy | family, sports, history | `THEIR [RELATION] [PAST EVENT], NOW [NEXT GENERATION] [RESULT]` |
| Comeback/reaction | sports and fandom | `[GROUP] REACTS TO [TEAM/PERSON]'S [COMEBACK/LOSS/WIN]` |
| Economic impact | country, tourism, business | `[EVENT] COULD BOOST [PLACE/INDUSTRY] BY [BIG RESULT]` |
| Weird utility | body, science, life hacks | `[NUMBER] WEIRD WAYS TO [DESIRABLE CONTROL]` |

## Headline generation prompt

```txt
You are creating a Pubity-style Instagram carousel headline.

Input:
- Trend:
- Domain:
- Market:
- Main person/entity:
- Emotional trigger:
- Why people care:

Rules:
1. Write in ALL CAPS.
2. Use 6-11 words whenever possible.
3. Target 34-64 characters.
4. Must fit in 2-3 visual lines.
5. Use simple words.
6. One idea only.
7. Make it instantly understandable without context.
8. Prefer curiosity, reaction, emotion, surprise, status, legacy, debate, or cuteness.
9. Do not sound like a newspaper.
10. Do not use clever wordplay if it reduces clarity.

Create 20 headline options in these buckets:
- Internet reacts
- Hidden side
- Today/milestone
- Surprising fact
- Emotional human/animal
- Ranking/list
- Legacy/history
- Money/economic impact

For each option return:
Headline:
Words:
Characters:
Estimated lines:
Emotion:
Why it works:
```

## Comment architecture

Goal:
Comments should create identity, debate, humor, defense, nostalgia, and community.

| Comment type | Function | Example pattern |
|---|---|---|
| Defender | fans defend a person/team | `People hate on him, but he gave everything for the game.` |
| Rival fan | starts sports debate | `Messi fans won't like this one.` |
| Nostalgia | creates emotional memory | `This generation will never understand how big this moment was.` |
| Joke observer | easy likes | `Bro just wanted to be included.` |
| Fact corrector | starts replies | `Actually this happened before the final, not after.` |
| Country pride | unites national audience | `Cape Verde deserves this moment.` |
| Moral take | debate and values | `This is why character matters more than stats.` |
| Relatable | broad connection | `That dog is literally me in every family photo.` |
| Hot take | disagreement engine | `This is the greatest World Cup story so far.` |
| Question | invites replies | `Who had the better comeback, Argentina or Switzerland?` |

## Comment prompt

```txt
Given this trend and headline, create comment seeds that feel like real Instagram comments.

Inputs:
- Trend:
- Headline:
- Main entity:
- Fan groups:
- Opposing opinions:
- Emotional trigger:

Return:
1. 5 funny comments
2. 5 debate comments
3. 5 defender comments
4. 5 nostalgia comments
5. 5 question comments
6. 5 country/fan-pride comments if relevant

Rules:
- Short.
- Human.
- No corporate tone.
- Designed to get replies.
- Include at least 3 comments that another person could disagree with.
- Include at least 3 comments that make fans defend someone.
```

## Carousel system after trend capture

```txt
Trend detected
|
Headline generated
|
Visual selected
|
Carousel structure:
  Slide 1: Pubity-style headline
  Slide 2: context
  Slide 3: why people care
  Slide 4: reactions / debate
  Slide 5: twist / comparison
  Slide 6: question / CTA
|
Caption:
  Short summary + debate question
|
Comment seeds:
  Humor + defense + rivalry + nostalgia
```

## Vision Board placement

```txt
Attention Intelligence OS
|
+-- Trend Capture Column
|
+-- Pubity Carousel Headline Engine
|   +-- Headline formulas
|   +-- Visual constraints
|   +-- Comment architecture
|   +-- Caption patterns
|
+-- Carousel/Reel Factory
```
