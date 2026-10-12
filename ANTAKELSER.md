# Antakelser

Valg jeg tok. Alle kan endres.

## Konsept
- **Ny app, ikke Jarvis 1.** Ingen fem faner, ingen ni agenter, ingen kortdashbord. Bygget fra rapporten: et ytre arbeidsminne som kommer til deg.
- **Nettapp nå**, som du valgte. Den er en testbenk for konseptet. Det viktigste (låseskjerm, handlingsknapp, varsler når appen er lukket) krever en iPhone-app.
- **Én stemme foran**, som du valgte. Du snakker med Jarvis. Bak står seks agenter med navn, jobb, verktøy og grenser, synlige i fanen Agenter. Ingen avatarer, ingen agent-chat.
- **Tilbakekomstregel på alt.** Typer: tid, morgenbrief, kveld, ledig tid, sted, person, søndag, arkiv. Det er denne mekanikken som skal teste om «husk» kan bli systemets jobb.
- **Spørsmål lagres ikke.** «Kan du minne meg på …?» er en bestilling og lagres; «hva har jeg på fredag?» er et spørsmål og besvares.
- **Usikre setninger** («Emma sa at …», «lurer på om …», «tror …») blir notater, ikke frister eller avtaler.
- **«Jarvis» som navn**, fordi prosjektet heter det.

## Planleggeren
- **Samlet rett før fristen, med én bufferdag.** Ditt eksempel (arbeidskrav mandag, planlagt fredag før) gir onsdag–torsdag med fredag som buffer. Alternativet, å spre arbeidet jevnt over to uker, ga en økt hvert fjerde døgn og mer å huske på.
- **En kikk tidlig.** Er arbeidet mer enn tre dager unna, får du 15 minutter med oppgaveteksten i dag eller i morgen, så du kan spørre i tide. Glipper kikken, faller den bort uten beskjed.
- **Økter på 25–60 minutter**, maks tre om dagen og rundt to timer, i tiden 08–21:30, ti minutter fra avtaler. Andre fristers økter teller med.
- **Hverdager først.** Helga bare når det er trangt, eller hvis du slår det på under Meg.
- **Ferie og hyttetur** (heldagsavtaler med slike ord) holdes fri. Andre heldagsavtaler (bursdag) stopper ikke økter.
- **Leveringspåminnelse** kl. 10 på fristdagen, to timer før et klokkeslett, eller kvelden før en eksamen. Aldri før siste økt.
- **Flytting med minst mulig uro.** Bare økter som glapp eller kolliderer, flyttes. Resten står, så det du har lagt i Google Kalender stemmer.
- **Spørsmålene er valgfrie.** Planen lages uansett. Svaret på «når jobber du best» huskes.
- **Malene** (innlevering, eksamen, presentasjon, søknad, generell) er grove. Skreddersy med Claude gir steg for akkurat den oppgaven.

## Handlinger
- **Ingenting går ut av appen uten trykk.** Utkast åpnes i Meldinger eller e-post, eller kopieres. Med Gmail koblet til kan e-post sendes fra appen, men bare etter to trykk (Send med Gmail, så Ja, send) eller et ja i køen.
- **Alt kan angres**, og alt står i Bak kulissene med hvem som gjorde det.
- **«Har dårlig tid?»** flytter bare ting uten eget klokkeslett. Påminnelser du har satt tid på, står.
- **Steg i frister** spres fram mot fristen, ikke alle i første uke. Steg som glapp, flyttes fram uten kjeft.
- **Stillhetsbudsjett: 5 dytt om dagen** som standard. Det du allerede ser på Nå, gir ikke dytt.
- **Sted er noe du trykker inn** («Hvor er du?»), og glemmes etter tre timer. Ingen sporing.

## Agentene
- **Verktøyene er bekreftet mot dine egne koblinger.** En engangsjobb i skyen leste navnene og skjemaene til Gmail og Google Kalender 8. oktober (lagret i `scripts/fixtures/connectors.json`, uten dine data). Appen bruker search_threads, get_thread, create_draft, send_message, list_events, create_event og update_event, og leser skjemaet på nytt fra koblingen når du har sagt ja (describeTool). Mangler et påkrevd felt, sendes ingenting.
- **Tider til Google Kalender** sendes som lokal tid uten forskyvning, slik koblingen ber om, og tidssonen hentes fra kontoen din.
- **Varsel på telefonen:** øktene får et varsel fem minutter før, leveringen når den starter.
- **Postagenten får ikke et send-verktøy.** Den leser og foreslår. Svar og nye frister havner i køen.
- **Kalenderagenten henter de neste åtte dagene** hver halvtime mens appen er åpen. Avtaler som starter med «Jarvis:» er appens egne og hentes ikke tilbake.
- **SMS kan ikke sendes** fra en nettside eller fra claude.ai. Det krever iPhone-appen.
- **Morgen og kveld** kjøres som planlagte oppgaver på claude.ai. De bruker litt av Claude-kvoten din. De skriver aldri i planen din; de legger forslag i en egen innboks som appen fletter inn.

## Claude
- **Appens egen sortering går først.** Den er rask og virker uten nett. Claude brukes bare når appen er usikker, til åpne spørsmål og til «Skriv bedre med Claude» på utkast. Koden kontrollerer alltid forslaget (datoer, typer, steder).
- **Raskeste modell** («quick») for sortering, så det tar et par sekunder.

## Design
- **Himmel som følger klokka** som signatur: tiden blir noe du ser rundt deg. Kan skrus av.
- **Glass bare på kontrollene**, solid innhold. Apple rygget selv på klart glass etter kritikk for lesbarhet; tonet er standard her.
- **Fonter:** Bricolage Grotesque, systemfonten og Geist Mono fra Google Fonts. Uten nett brukes systemfonter.
- **Farger:** kjølig, lys grunn og indigo aksent. Rav for «snart», terrakotta for frister, aldri rødt.

## Data
- **Eksempeldagen** er en tenkt student, merket «Eksempeldag». Den lages på nytt hver dag; ting du fanger i den, blir med.
- **Egne ting** lagres i nettleseren og privat på claude.ai-kontoen. Skyen vinner over en ny, tom enhet.
- **Tidssone Europe/Oslo**, norsk bokmål. «kl 3» tolkes som 15:00, «halv ti» som 09:30.

## Vær
- **Yr** (NRK og Meteorologisk institutt) via morgen- og kveldsjobben på claude.ai. Open-Meteo når appen kjører som fil. Nettet er stengt for siden på claude.ai.

## Ikke bygget nå
iPhone-app og egen server, SMS, Entur, kroppsdobling med andre mennesker, økonomi, Android.
