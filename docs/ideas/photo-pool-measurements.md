# Photo pool yield: full-corpus measurement (ticket 01)

Date: 2026-10-02. Gate input for `.scratch/photo-game` ticket 01
(go with pool / kill the slice). "Verified" = observed in code or a live
check. Raw probe output lived in `/tmp` (volatile); numbers transcribed here.

Reference database: local `data/kpop.db` snapshot present on 2026-09-29
(gitignored). Corpus: 498 distinct person names linked by accepted
`has_member`/`member_of` facts.

## 1. Method

Per idol, in order, all sequential with the repo's `MediaWikiClient`
(identifiable `User-Agent`, `maxlag=5`, 30 s timeout) against
`commons.wikimedia.org/w/api.php`:

1. Category search (namespace 14) for the idol name; best token-overlap
   match wins (`Category:<Name>` exact preferred).
2. `categorymembers` of that category, files only, capped at 50 per idol.
3. Batched `imageinfo` (`url|user|extmetadata|mediatype|size`); keeper =
   `mediatype == BITMAP` and `LicenseShortName` in
   `media_registry.PERMITTED_LICENSES` (exact match).

Limitations: the 50-file cap truncates big categories (top idols show
50/50: their real counts are higher, which only helps the gate);
`extmetadata` license strings are taken at face value before human review.

## 2. Corpus numbers

- 498 idols probed, 0 errors.
- 393/498 (79%) have a matching Commons category.
- 164/498 (33%) have ≥1 license-passing keeper; 1167 keepers total.
- 118/498 (24%) have ≥2 keepers (pool-candidate bar from the spec).
- Portrait pre-filter (short side ≥400px, title without
  signature/logo/cover/merch/poster): 1092 survivors across 151 idols,
  110 idols with ≥2.
- `"Public domain"` (lowercase d, as Commons returns it) vs the gate's
  `"Public Domain"`: 269 BITMAP files fall in this gap. Sampled titles are
  almost all wrong-subject (biblical Asa, Greek Athena, MOAB bombs for
  B-Bomb, Victorian Castles) or signatures, so normalizing the case would
  not move the gate. Recorded as a code nit for a dedicated ticket.

## 3. Visual curation sample (16 files, 16 idols)

Thumbs via `Special:FilePath/...?width=320`, viewed file by file:

| # | idol | file | verdict |
|---|---|---|---|
| 00 | Ahyeon | Summer Sonic 2026 | depicts idol |
| 01 | Asa | Ls1.jpg (garden) | wrong subject |
| 02 | B-Bomb | MOAB glide bomb | wrong subject |
| 03 | Bailey Sok | 250708 | depicts idol |
| 04 | Castle J | Sweet Kitty Bellairs 1906 | wrong subject |
| 05 | Changbin | Changbin Port (harbor) | wrong subject |
| 06 | Chuei Liyu | Boys II Planet | depicts idol |
| 07 | Daemon | Pernicious movie people | wrong subject |
| 08 | Felix | Cervolix 2010 (kites) | wrong subject |
| 09 | Gawon | PRADA Photo Call 2025 | depicts idol |
| 10 | Athena | plaque photo | wrong subject |
| 11 | Brian Joo | Brian Joo.jpg | depicts idol |
| 12 | Choi Hyun-suk | TREASURE backdrop | depicts idol |
| 13 | Dawn | Umbrella Revolution sign | wrong subject |
| 14 | Elly | NTS 1967 photo of a man | wrong subject |
| 15 | Eric | Esinger.jpg | uncertain (unconfirmed identity) |

Result: 6-7/16 depict the idol (~40%). Category grounding is necessary but
nowhere near sufficient. Same-name places, objects, historical figures, and
event photos dominate. Per-file human verification at ticket 02 registration
is mandatory.

## 4. Gate decision: GO, conditional

- Corpus viability: GO. ~118 candidate idols, ~110 surviving portrait
  pre-filter; at ~40% visual precision the verified pool should land near
  45-50 idols: enough for a curated-pool game, not for full-catalog daily
  rotation (that design stays dead, as the spec already states).
- Kill bar for ticket 02: if per-file verification yields fewer than 40
  idols with ≥2 verified portraits, kill the slice instead of shipping a
  repetitive game.
- Ticket 02 is unblocked with one hard requirement: no file ships without a
  recorded human verdict (depicts the idol, portrait, resolution) next to
  `verified_at`. Revalidation cadence covers later Commons deletions.

## 5. Pool candidate table (118 rows)

`keepers` counts license-passing BITMAP files (cap 50/idol); `pc` counts
portrait pre-filter survivors. Ordered by keepers descending.

| idol | QID | groups | keepers | pc |
|---|---|---|---|---|
| Kim Dong-hyun | Q16080205 | BF | 50 | 50 |
| Lee Seung-hoon | Q15931598 | Winner | 50 | 49 |
| Dawn | Q42101185 | Pentagon | 49 | 49 |
| RAM | Q112023176 | D-Unit | 46 | 36 |
| Kang Seul-gi | Q15934116 | Red Velvet | 44 | 44 |
| Kim Woo-jin | Q61100680 | Stray Kids | 44 | 44 |
| Yukyung | Q57600715 | Alice | 30 | 30 |
| Eric | Q61750285 | The Boyz | 29 | 28 |
| Jennie | Q26262599 | Blackpink | 29 | 29 |
| Sohee | Q483633 | Wonder Girls | 29 | 29 |
| Yua Mikami | Q22128111 | Honey Popcorn | 28 | 27 |
| Monday | Q93969529 | Weeekly | 23 | 23 |
| Zico | Q7696122 | Block B | 23 | 18 |
| Paan | Q136898057 | VVUP | 22 | 21 |
| Isa | Q106518536 | STAYC | 20 | 12 |
| Athena | Q129548317 | Fifty Fifty | 19 | 18 |
| Kevin | Q11704112 | ZE:A | 18 | 17 |
| Park So-eun | Q93969530 | Weeekly | 18 | 18 |
| Kyle | Q68479278 | ROMEO | 16 | 16 |
| Siwoo | Q138520581 | JUST B | 15 | 15 |
| Jay | Q105717862 | Enhypen | 14 | 11 |
| Jisun | Q16091817 | Girl's Day | 14 | 14 |
| Kim Tae-young | Q97320161 | Cravity | 14 | 12 |
| Moko Sakura | Q53764878 | Honey Popcorn | 14 | 14 |
| Seline | Q84324503 | Cignature | 14 | 14 |
| Brian Joo | Q489103 | Fly to the Sky | 13 | 13 |
| Saki | Q141030888 | Tuide | 13 | 11 |
| Yujeong | Q109257515 | Lightsum | 13 | 13 |
| Jung Woo-young | Q65054015 | Ateez | 12 | 11 |
| Lisa | Q26707663 | Blackpink | 12 | 12 |
| JIN | Q18381209 | Lovelyz | 11 | 10 |
| Jackie | Q132171310 | ICHILLIN' | 11 | 11 |
| Mir | Q11242163 | MBLAQ | 11 | 11 |
| Yang Jung-won | Q105717977 | Enhypen | 11 | 11 |
| Yeri | Q19940498 | Red Velvet | 11 | 7 |
| Elly | Q47460217 | Weki Meki | 10 | 10 |
| Jun | Q49580130 | UNB | 10 | 10 |
| Saena | Q117178278 | Ablume | 10 | 10 |
| Soojin | Q61100297 | I-dle | 10 | 10 |
| Wooyeon | Q111264396 | Wooah | 10 | 10 |
| Jiyoon | Q132171303 | ICHILLIN' | 9 | 9 |
| Solar | Q19483969 | Mamamoo | 9 | 8 |
| Yoon Jiyoon | Q127162746 | Izna | 9 | 9 |
| Choi Hyun-suk | Q63850969 | Treasure | 8 | 8 |
| Gaon | Q114403435 | Xdinary Heroes | 8 | 8 |
| Songhee | Q64038543 | Bvndit | 7 | 7 |
| Hui | Q43089418 | Pentagon | 6 | 4 |
| Jun Han | Q114403328 | Xdinary Heroes | 6 | 6 |
| Jungwoo | Q64039138 | Bvndit | 6 | 6 |
| Sangwoo | Q138519696 | JUST B | 6 | 6 |
| Yi Hani | Q141030895 | Tuide | 6 | 6 |
| Han | Q60994278 | Stray Kids | 5 | 5 |
| Lee Jae-hee | Q93970112 | Weeekly | 5 | 4 |
| Rina | Q47687990 | Weki Meki | 5 | 5 |
| Sei | Q42850795 | Weki Meki | 5 | 4 |
| Sio | Q112692559 | Superkind,Ablume | 5 | 5 |
| Soobin | Q62396828 | Tomorrow X Together | 5 | 4 |
| Wish | Q112023395 | Epex | 5 | 5 |
| Yeo One | Q67987298 | Pentagon | 5 | 2 |
| Asa | Q123554438 | Babymonster | 4 | 4 |
| Hyunjae | Q61100807 | The Boyz | 4 | 4 |
| Kilala | Q140768331 | Ourbirthday | 4 | 4 |
| MiU | Q114554571 | Madein | 4 | 4 |
| Seeun | Q106518627 | STAYC | 4 | 4 |
| Shotaro Osaki | Q104604557 | Riize | 4 | 4 |
| Siyeon | Q59313326 | Dreamcatcher | 4 | 4 |
| Yoo Il | Q24862720 | 5urprise | 4 | 4 |
| Younghoon | Q61863509 | The Boyz | 4 | 4 |
| Ahyeon | Q123560890 | Babymonster | 3 | 3 |
| B-Bomb | Q10846505 | Block B | 3 | 2 |
| Bailey Sok | Q123912453 | AllDay Project | 3 | 3 |
| Changbin | Q61100669 | Stray Kids | 3 | 3 |
| Chuei Liyu | Q137554623 | Flare U | 3 | 3 |
| E-VAN | Q137883959 | DAILY:DIRECTION | 3 | 1 |
| Felix | Q61100678 | Stray Kids | 3 | 3 |
| Gawon | Q132147276 | Meovv | 3 | 3 |
| Haerin | Q113508917 | NewJeans | 3 | 3 |
| Jinho | Q41967606 | Pentagon | 3 | 3 |
| Jo Woo-chan | Q47088961 | AllDay Project | 3 | 3 |
| Karin | Q54597211 | Alice | 3 | 3 |
| Kelly | Q105592481 | Tri.be | 3 | 3 |
| Kim Ji-an | Q115588873 | Lightsum | 3 | 3 |
| Kim Jin-ho | Q12588889 | SG Wannabe | 3 | 3 |
| Kotoko | Q125222461 | Unis | 3 | 3 |
| Mimi | Q29876869 | Oh My Girl | 3 | 3 |
| Minji | Q113561403 | NewJeans | 3 | 3 |
| Narin | Q132147277 | Meovv | 3 | 3 |
| Ni-Ki | Q108043218 | Enhypen | 3 | 3 |
| Park Won-bin | Q123528897 | Riize | 3 | 3 |
| Qri | Q487897 | T-ara | 3 | 2 |
| Seungmin | Q60467634 | Stray Kids | 3 | 3 |
| Tarzzan | Q135580628 | AllDay Project | 3 | 3 |
| Yuki | Q107559923 | Purple Kiss | 3 | 3 |
| Castle J | Q97704455 | MCND | 2 | 2 |
| Choi Min-hwan | Q5103936 | F.T. Island | 2 | 0 |
| Daemon | Q112692536 | Superkind | 2 | 2 |
| Hina | Q112966239 | Lightsum | 2 | 2 |
| Hwang Ye-ji | Q60870268 | Itzy | 2 | 1 |
| Jaehyo | Q16172073 | Block B | 2 | 2 |
| Jihoon | Q97352001 | Treasure | 2 | 2 |
| Jisoo | Q27655361 | Blackpink | 2 | 2 |
| Jo Young-min | Q11346187 | BF | 2 | 2 |
| Kei | Q12588803 | Lovelyz | 2 | 2 |
| Kim Na-young | Q110405051 | Lightsum | 2 | 2 |
| Kim Su-hye | Q114554575 | Madein | 2 | 1 |
| Lee Chan-hyuk | Q16071030 | AKMU | 2 | 2 |
| Lee Jae-jin | Q624401 | F.T. Island | 2 | 1 |
| Lee Seung-yeop | Q9205048 | A-Jax | 2 | 1 |
| Lua | Q47669568 | Weki Meki | 2 | 2 |
| Miya | Q60175319 | GWSN | 2 | 2 |
| Moon Joon-young | Q6854182 | ZE:A | 2 | 2 |
| Shin Yu-na | Q60870263 | Itzy | 2 | 1 |
| Sora | Q111264397 | Wooah | 2 | 2 |
| U-Kwon | Q27951485 | Block B | 2 | 2 |
| Wooseok | Q61863582 | Pentagon | 2 | 2 |
| Yoon Do-woon | Q67674200 | Day6 | 2 | 2 |
| Yoshi | Q98136892 | Treasure | 2 | 2 |
| Zhang Hao | Q117832250 | And2ble | 2 | 1 |
