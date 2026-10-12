# Jarvis

Et ytre arbeidsminne. Du sier det med én setning, Jarvis sorterer det og gir hver ting en regel for **når den skal komme tilbake**: et klokkeslett, et sted, en person, når du har ledig tid, i morgenbriefen eller søndag. Du skal slippe å huske å sjekke en liste. Tingene kommer til deg.

Bygget etter rapporten «Jarvis kritikk og ny ADHD app» (ligger i prosjektet som `jarvis/RAPPORT-ny-app.md`). Dette er nettversjonen, ment som testbenk før en ekte iPhone-app.

## Slik virker den

1. **Fang.** Skriv i feltet nederst, som du ville sagt det: «kjøp melk og si til jonas at jeg kommer kl 18», «arbeidskrav i markedsføring mandag 19. oktober», «ring tannlegen i morgen», «Emma sa at eksamen er flyttet».
2. **Sortert, med en tilbakekomst.** Hver ting får en linje som «↺ kommer når du er på butikken» eller «↺ i morgen kl. 07:30». Ett trykk endrer den. Små oppgaver får også et forslag til når de passer: «Passer i dag 14:15 (ledig til 15:30)».
3. **Store frister blir en plan med en gang.** Planleggeren regner bakover fra fristen og legger økter i ledig tid (se under). Så spør Jarvis: «Har du to minutter til å finpusse den?» Ja gir fire kjappe spørsmål; nei, og planen står.
4. **Kommer tilbake.** På Nå-skjermen under «Dukker opp nå», som et varsel mens appen er åpen, eller i telefonens kalender hvis du legger den der.
5. **Gjør.** Én ting nå, med et første lite steg og en knapp som starter en økt. Meldinger og e-post er ferdige utkast du sender selv med ett trykk.
6. **Tilbake uten skam.** Har du vært borte, rydder Jarvis, sier hva som ble flyttet og gir deg én ting å starte med. Ingen tellere for det som glapp.

## Planleggeren: tenker bakover fra fristen

Eksempel: arbeidskrav mandag 19. oktober, planlagt fredag 9. eller onsdag 7. oktober:

- **I dag 13:45:** kikk på oppgaveteksten i 15 minutter og skriv ned spørsmål (så du kan spørre foreleseren i tide).
- **Etter kikken trenger du ikke tenke på den før onsdag kl. 12:00.** Den står under «Kan vente» på Nå.
- **Onsdag og torsdag:** to–tre økter hver dag (25–60 minutter), i ledig tid, aldri oppå avtaler.
- **Fredag er buffer** hvis noe glipper. Ellers fri.
- **Mandag 10:00:** «Sjekk kravene og lever».

Reglene:

- Arbeidet legges samlet i dagene rett før fristen, med én bufferdag. Rundt to timer om dagen, maks tre økter. Andre fristers økter teller med.
- Hverdager først. Helga brukes bare når det er trangt, eller hvis du slår det på.
- Er det trangt, starter øktene i dag, og selve fristdagen kan brukes. Blir det over fire timer en dag, sier Jarvis det ærlig.
- Ferie og hyttetur i kalenderen (heldagsavtaler) holdes fri.
- Eksamen: siste økt dagen før, og «Pakk sekken og legg deg tidlig» kl. 20 kvelden før.
- Fire kjappe spørsmål justerer planen: hvor mye du har gjort, hvor stor den er, hva som blir vanskeligst (komme i gang gir et mini-steg først; skriving gir kortere økter; «rekke det» gir mer buffer) og når på dagen du jobber best (huskes).
- «Skreddersy stegene»: lim inn oppgaveteksten, så foreslår Claude stegene. Koden bestemmer fortsatt når de gjøres, og du ser planen før noe endres.
- Glipper en økt, eller kommer det en avtale oppå, flyttes bare den økta til nærmeste ledige tid. Resten står. En kikk som glipper, faller bort.
- På Nå: «Økt nå · 12:00–12:45» med Start, Bare 5 min og Ikke nå. Før økta: «Kan vente».

## Agentene

En fjerde fane, **Agenter**, viser teamet bak Jarvis, hva hver gjør, hva de har lov til, og alt som venter på ditt ja.

| Agent | Jobb | Lov til |
|---|---|---|
| Planleggeren | Legger frister i ledig tid og flytter økter som glapp | Gjør selv, du kan angre |
| Postagenten | Leser Gmail: frister, beskjeder fra forelesere, e-post som venter på svar. Lager svarutkast | Leser selv. Sender aldri uten trykk |
| Kalenderagenten | Henter Google Kalender inn i dagen, legger øktene i kalenderen så telefonen varsler | Leser selv. Skriver bare med ja |
| Budbringeren | Utkast til meldinger og e-post. Sender e-post via Gmail når du trykker to ganger | SMS sender du selv |
| Påminneren | Varsler i appen, morgen- og kveldsmelding til telefonen | Maks fem dytt om dagen |
| Rydderen | Rydder om natten og etter pauser | Sletter aldri |

Skriv «sjekk mailen», «hent kalenderen», «legg øktene i kalenderen» eller «planlegg fristene» i feltet, eller trykk i Agenter.

**Slik virker teknikken** (samme oppskrift som agent-apper som Grok Bot, bygget på Claude):

1. **En hjerne med verktøy.** Postagenten er Claude i en løkke med fire verktøy: søk i Gmail, les en tråd, foreslå en ting, foreslå et svar. Den velger selv hva den leser, runde for runde. Den har ikke noe send-verktøy.
2. **Koblinger med dine innlogginger.** Gmail og Google Kalender kobles til på claude.ai. Appen leser verktøyenes skjema fra koblingen (`describeTool`) og tilpasser argumentene, så den ikke gjetter. Navnene og skjemaene er sjekket mot dine koblinger.
3. **Rutiner.** Mens appen er åpen: kalenderen hver halvtime, fristene hvert kvarter. I skyen: to planlagte oppgaver, morgen og kveld, som leser planen din, henter været fra Yr, kan sjekke Gmail, og sender en melding til telefonen.
4. **Minne.** Tingene dine, planen og loggen ligger privat på kontoen din.
5. **Godkjenningskø.** Alt som går ut av appen (e-post, nye eller flyttede avtaler i Google Kalender), venter på ditt trykk. Dobbelttrykk sender ikke to ganger. Tekst i e-poster behandles som data, aldri som instruksjoner.

## Spørsmål og kommandoer

Spørsmål blir svar, ikke oppgaver: «hva har jeg på fredag?», «når må jeg gå?», «hva skal jeg gjøre nå?», «hva har jeg glemt?». Kommandoer virker: «jeg er på butikken», «flytt lunsj med sara til 13», «ferdig med kap 4», «jeg står fast», «har dårlig tid».

## Fire steder

- **Nå**: tiden synlig («Ledig i 1 t 30 min · Gå 14:55»), Nå-kortet med én ting og hvorfor (eller økta som er nå), det som dukker opp nå, utkast som venter på et ja, «Kan vente», og resten av dagen som en stripe.
- **Dag**: tidslinje med avtaler, planlagte økter (stripete), ledige luker du kan fylle («hva passer her?»), «Gå»-merker og dagens økter.
- **Tanker**: alt du har fanget, gruppert etter når det kommer tilbake. Søk: «hva tenkte jeg om pitchen?».
- **Agenter**: teamet, godkjenningskøen og hva de har gjort.

Pluss: fokus med en Time Timer-skive, morgenbrief med været gjort om til handling, kveldsavslutning, Uka di («dette fikk du til»), Bak kulissene (jobbene og alt som er gjort, med angre) og Meg (sanser, dytt, data).

## Barkley i praksis

| Problem (Barkley) | Hva appen gjør |
|---|---|
| Hjelp må komme der handlingen skjer | Tilbakekomstregler for tid, sted og person; varsler; påminnelse i telefonens kalender |
| Tidsblindhet | Tiden står alltid øverst, «Gå 14:55», ring som krymper, skive i fokus, himmelen følger klokka |
| Arbeidsminne | Fangst med én setning, også midt i en økt («Jeg kom på noe») |
| Prioritering | Koden velger én ting og sier hvorfor; energi i dag tas med |
| Komme i gang | Første lille steg, «Bare 5 min», «Gjør den mindre», «Står fast?» med tre veier inn |
| Lange frister | Planleggeren regner bakover fra fristen, legger økter i ledig tid og sier når du ikke trenger å tenke på den; leveringspåminnelse på fristdagen |
| Følelser og frafall | Comeback uten skam, ingen streaks, Uka di teller bare det du fikk til |

Appen spør aldri om diagnose, og er et planleggingsverktøy, ikke behandling.

## Hvor den kjører

| | På claude.ai | Som fil (`dist/jarvis.html`) |
|---|---|---|
| Lagring | Privat på din konto + nettleseren | Nettleseren |
| Agentene (Gmail, Google Kalender) | Ja, når du har koblet dem til på claude.ai | Nei |
| Claude (sorterer uklare ting, åpne spørsmål, bedre utkast) | Ja, spør om lov første gang | Nei, appen sorterer selv |
| Vær | Fra Yr via morgen- og kveldsjobben | Open-Meteo |
| Snakke inn | Nei (mikrofon er sperret der) | Ja, i Safari og Chrome |
| Påminnelse i kalenderen | Google Kalender-lenke | Google Kalender-lenke og .ics for iPhone |
| Åpne Meldinger/e-post | Virker ikke alltid; «Kopier tekst» virker | Ja |

Jarvis sender aldri noe uten at du har trykket. Varsler i appen kommer mens den er åpen. På låseskjermen kommer morgen- og kveldsmeldingen (planlagte oppgaver på claude.ai), og øktene hvis du legger dem i Google Kalender.

## Design: «stille glass»

Glass bare på det som flyter (skrivefeltet, fanene, arkhodene, varsler). Innhold på faste flater. Himmelen bak følger klokka: lys morgen, blek dag, varm ettermiddag, blå time om kvelden. Én indigo aksent på én primærhandling. Tid er farge: rav når det haster, myk terrakotta for frister, aldri alarmrødt. Fonter: Bricolage Grotesque til store øyeblikk, systemfonten (SF Pro på iPhone) til tekst, Geist Mono til tall. Under Meg kan du skru ned bevegelse, gjøre glasset solid, slå av himmelen, velge større tekst og lesefonten Atkinson Hyperlegible.

## Kjør og test

```
npm test            # 52 enhetstester: sortering, tider, Nå, planleggeren, agentene, jobber, comeback
npm run build       # dist/jarvis.html og dist/jarvis-artifact.html
npm run e2e         # hele flyten i Chromium med låst klokke, 49 sjekker, skjermbilder i screenshots/
npm run e2e:agents  # agentene mot en falsk claude.ai med falske koblinger, 30 sjekker
npm run dev         # http://localhost:5173
```

Ingen tredjepartsbiblioteker. Playwright brukes bare til e2e.

## Mappestruktur

```
core/        ren logikk: sortering (sort.js), tider (when.js, due.js), Nå (now.js), planleggeren (planwork.js),
             agentene (agents.js), steg, brief, jobber, påminnelser, vær
core/test/   enhetstester
app/         store (lagring og synk), actions (alt med angre), brain (sortering + Claude), agents (koblinger,
             verktøyløkka og godkjenning), vær, himmel, stemme
app/ui/      ark, deler, flyter (alle arkene), planen, fokus
app/screens/ Nå, Dag, Tanker, Agenter
scripts/     bygg, utviklingsserver, e2e
```

## Dette trenger jeg fra deg

1. **Koble til Gmail og Google Kalender** under Innstillinger → Koblinger på claude.ai. Åpne så appen, gå til Agenter og trykk «Koble til». Første gang spør claude.ai om lov.
2. **Bytt til Mine ting** (Meg → Data) og fang en ekte frist, for eksempel neste arbeidskrav.
3. **Godkjenn de planlagte oppgavene** (morgen og kveld) hvis claude.ai spør, så meldingene kommer på telefonen.
4. **Test i en uke** og noter når en økt kom feil, eller når Postagenten foreslo noe rart.
5. **En teknisk medgründer eller iOS-utvikler**, Mac og Apple-utviklerkonto for iPhone-appen (låseskjerm, handlingsknapp, klokke).

## Før lansering

- Claude-kallene må gå via en egen server, aldri med nøkkel i nettleseren.
- Agentene må kjøre på en server med egne OAuth-koblinger til Gmail og Google Kalender, og en kø for godkjenning. På claude.ai låner appen dine koblinger.
- Behandle dataene som helsedata: samtykke, personvernkonsekvensvurdering, databehandleravtaler, lagring i EU/EØS.
- Markedsfør som planleggings- og huskeverktøy, ikke som behandling.
