# Orbite — atlante stellare

## Avvio

### Server Node.js
Richiede Node.js 18 o successivo. Dalla cartella del progetto:

```powershell
npm start
```

Apri `http://127.0.0.1:3000` nel browser. Per lo sviluppo con riavvio automatico del server quando modifichi i file:

```powershell
npm run dev
```

### Backend FastAPI (Chatbot)
Il backend FastAPI gestisce le query del chatbot tramite Ollama e ChromaDB.

1. Entra nella cartella `backend`:
   ```powershell
   cd backend
   ```
2. Attiva l'ambiente virtuale (se non è già attivo):
   ```powershell
   .\.venv\Scripts\activate
   ```
3. Installa le dipendenze:
   ```powershell
   pip install -r requirements.txt
   ```
4. Avvia il server FastAPI:
   ```powershell
   uvicorn app.main:app --reload
   ```
   Il server sarà disponibile su `http://127.0.0.1:8000`.

### Frontend statico e URL delle API

Con Live Server a `http://127.0.0.1:5500` o `http://localhost:5500`, il frontend usa FastAPI a `http://127.0.0.1:8000` per `/api/status` e `/api/exoplanets`. Sulle altre origini usa per impostazione predefinita l'origine della pagina, inclusa l'installazione Node a porta 3000.

Per un'origine API diversa imposta `content` nella meta `spacefree-api-base` di `index.html` con l'URL pubblico del backend, ad esempio `http://127.0.0.1:8000`. Il valore `/` forza la stessa origine anche a porta 5500. Un server statico non legge il file `.env` per configurare il browser. Se usi un'origine Node separata, aggiungi l'origine del frontend a `CORS_ORIGIN` sul server Node.

Il badge di FastAPI indica se il modello configurato è presente nell'elenco modelli di Ollama. Con le API Node, il badge indica lo stato di configurazione di OpenRouter. Il catalogo FastAPI legge la cache locale del NASA Exoplanet Archive.

### Posizioni nella mappa galattica

La spirale è un'illustrazione della Via Lattea. I punti di catalogo usano ascensione retta, declinazione e distanza pubblicate dal NASA Exoplanet Archive. Il piano galattico è X/Z e l'asse Y indica la quota. Il Sole è il riferimento locale, a circa 26.000 anni luce dal centro nel modello. I sistemi e gli oggetti senza una posizione 3D disponibile restano accessibili dalle schede, dalla ricerca o dai filtri. [Colonne del NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/docs/API_PS_columns.html)

Da 7× la vista galattica mostra una sola etichetta. Dà priorità al sistema in viaggio, all'etichetta con focus da tastiera e al punto sotto il cursore. Senza un bersaglio esplicito, mette in risalto il sistema più vicino al centro dell'inquadratura. Il disco, i bracci e il rigonfiamento della spirale vengono generati all'avvio come un unico livello di punti. [Illustrazione della Via Lattea, NASA](https://science.nasa.gov/resource/the-milky-way-galaxy/)

I filtri dei buchi neri usano un anello verde. Gaia BH1, BH2, BH3 e Cygnus X-1 usano astrometria pubblicata e distanze stimate, con le fonti nelle schede. Sagittarius A* è il riferimento centrale. Per le sonde, i rombi indicano le missioni attive e i quadrati tratteggiati quelle storiche. Le linee terminano al riferimento del Sistema Solare. La disposizione delle icone è sullo schermo e le schede indicano che la posizione individuale della sonda non è rappresentata.

Per aggiornare la cache usata da FastAPI, esegui `python backend/refresh_exoplanets.py` dalla radice del progetto dopo aver attivato l'ambiente virtuale del backend. Le voci con `galaxyId` associato a `atlasGalaxies` in `main.js` hanno gruppi Three.js separati. Per una futura galassia, definisci il suo sistema di riferimento prima di fornire coordinate locali `galaxyPosition`.

## Diagnostica del globo terrestre

- **Globo locale**. Apri [earth-test.html](http://127.0.0.1:3000/earth-test.html) oppure usa il link sotto il selettore dell'anno. La pagina richiede solo il server Node dopo `npm install`. Usa lo stesso renderer dell'atlante, una sfera e il JPEG locale in proiezione equirettangolare. Three.js è servito localmente.
- **Confronto con il raster storico**. Apri [l'atlante con il raster originale](http://127.0.0.1:3000/?earthRaw=1#earth-orbit) e confronta la stessa annata con la modalità normale. L'atlante usa la Blue Marble locale soltanto nelle lacune della texture ricevuta e indica fonte, data o periodo richiesto, copertura e sfondo. L'API restituisce il raster originale per impostazione predefinita. Il parametro `fill_gaps=true` richiede la composizione.
- **OpenZenith**. I tile documentati servono quota e batimetria. La loro eventuale integrazione richiede un adattatore terreno separato dal provider RGB storico. [Documentazione OpenZenith](https://openzenith.org/)

Per aggiungere un provider RGB, registra in `backend/app/services/earth_imagery.py` una funzione che costruisca le richieste per il provider. Il servizio valida la texture equirettangolare 2:1 e trasmette la fonte dal backend al frontend. Un provider indisponibile produce uno stato di errore o un fallback statico dichiarato in caso di mancata connessione.

Nel renderer orbitale lo spostamento di 180° è applicato alla geometria e le coordinate UV conservano l'intera estensione del raster. La sfera usa le normali originali di Three.js e lo zoom tiene il profilo dentro l'inquadratura. I raster GIBS hanno mostrato lacune prima del rendering, con pixel neri opachi negli esempi WMS e trasparenza supportata da Worldview Snapshots. Nuvole e atmosfera della vista Sistema Solare sono mesh distinte definite in `map3d.js`. La pagina di test riproduce il renderer del globo orbitale.

### Configurazione e test di Copernicus

Imposta queste variabili nell'ambiente FastAPI o in `backend/.env` se avvii Uvicorn dalla cartella `backend`. Le trovi in `.env.example`. Mantieni l'UUID nel backend.

| Variabile | Valore |
| --- | --- |
| `COPERNICUS_WMS_ENDPOINT` | URL HTTPS base che termina in `/wms`, senza UUID. Il valore predefinito è `https://sh.dataspace.copernicus.eu/ogc/wms`. |
| `COPERNICUS_WMS_INSTANCE` | UUID della Configuration Utility di Sentinel Hub, che autentica le richieste OGC. |
| `COPERNICUS_WMS_LAYER` | Identificativo di un layer RGB nella stessa istanza. Usa un mosaico in grado di servire una vista globale a bassa risoluzione, con `dataMask` come quarto canale per distinguere i pixel senza osservazione. |

Il globo richiede WMS 1.1.1, `SRS=EPSG:4326`, `BBOX=-180,-90,180,90` in ordine longitudine/latitudine e un PNG da 2048 × 1024. Per l'anno selezionato usa `TIME=YYYY-07-01/YYYY-09-30` dal 2015 in poi. L'endpoint basemap usa il periodo predefinito del layer. Verifica nelle capabilities della tua istanza che il layer supporti EPSG:4326 e nella pagina del dataset che copra il trimestre richiesto. Alcune collezioni Sentinel-2 native impongono limiti di risoluzione incompatibili con un singolo GetMap globale. [Specifiche WMS](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/OGC/WMS.html) [Maschera di copertura](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/UserGuides/Datamask.html) [Limiti di Sentinel-2 L2A](https://forum.dataspace.copernicus.eu/t/error-loading-sentinel-2-l2a-data/3182)

1. Avvia Node e FastAPI e apri [l'atlante Copernicus](http://127.0.0.1:3000/?earthProvider=copernicus#earth-orbit). Seleziona un anno coperto dal tuo layer. Verifica in Console l'assenza di errori CORS, di rete o di decodifica. L'atlante mostra il messaggio del backend sotto il selettore in caso di errore.
2. In Network apri `/api/earth/texture/{year}?provider=copernicus&fill_gaps=true` e controlla stato HTTP, tipo MIME e intestazioni. Prova anche il [PNG storico originale](http://127.0.0.1:8000/api/earth/texture/2020?provider=copernicus) e la [basemap](http://127.0.0.1:8000/api/earth/basemap?provider=copernicus).

| Risultato | Cosa verificare |
| --- | --- |
| Immagine remota con maschera | `200 image/png`, `X-Texture-Status: real` oppure `partial`, e `X-Image-Coverage`. `X-Image-Period` indica l'intervallo richiesto, non le date dei singoli pixel. |
| Immagine remota senza maschera | `200 image/png`, `X-Texture-Status: coverage-unknown`. La copertura resta indeterminata. |
| PNG parziale con sfondo | `X-Texture-Status: partial` e `X-Texture-Background: NASA Blue Marble Next Generation`. Usa `earthRaw=1` nell'atlante per vedere le lacune originali. |
| Fallback per problemi di connessione | `200 image/jpeg`, `X-Texture-Status: fallback`, `X-Fallback-Reason` e `Cache-Control: no-store`. |
| Dato indisponibile | JSON con `detail`, `X-Texture-Status: unavailable` e `X-Texture-Reason`. `503` per configurazione incompleta o errata, `404` per assenza di copertura e `502` per errori HTTP WMS o PNG non validi. Se il fallback locale manca, un timeout produce `504`. `X-Upstream-Status` riporta l'eventuale stato HTTP ricevuto a monte. |

Per ripetere i test con risposte WMS simulate, esegui `python -m unittest discover -s tests -v` dalla cartella `backend` con il suo ambiente virtuale attivo.

## Assistente LLM

La mappa, i calcoli locali, il filtro, il modello 3D e la cronologia delle missioni funzionano anche senza una chiave API. Copia `.env.example` in `.env` e incolla la tua chiave OpenRouter in `OPENROUTER_API_KEY`:

```powershell
Copy-Item .env.example .env
npm run dev
```

La chiave resta sul server e non viene inviata al browser. Puoi scegliere il modello con `OPENROUTER_MODEL`. Per un frontend separato, configura `CORS_ORIGIN` con le origini autorizzate, separate da virgola. Se frontend e backend sono serviti insieme, lascialo vuoto.

Per ottenere una chiave API, consulta [OpenRouter](https://openrouter.ai/keys).

## Dati e Distanze

Le distanze e i dati dei corpi planetari sono un archivio statico. Gli elementi della cronologia delle missioni sono eventi storici, non telemetria in diretta. Le distanze Terra–pianeta del Sistema Solare sono intervalli approssimati con orbite circolari; quelle degli esopianeti sono stime dalla distanza del sistema e dall’orbita.
