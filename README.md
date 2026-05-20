# Realtime Data API

API Node.js nho de luu tru JSON va phat update lien tuc qua Server-Sent Events.

## Chay API

```powershell
cd C:\Users\DELL\.codex\memories\realtime-data-api
npm start
```

Mac dinh API chay tai:

```text
http://localhost:3000
```

Co the doi port:

```powershell
$env:PORT=4000; npm start
```

## Endpoints

```text
GET    /
GET    /data
GET    /health
GET    /items
POST   /items
GET    /items/:id
PUT    /items/:id
PATCH  /items/:id
DELETE /items/:id
GET    /updates
POST   /updates
GET    /stream
```

Du lieu duoc luu trong file `data.json`.

Khi deploy len hosting co persistent disk, dat bien moi truong:

```text
DB_PATH=/var/data/data.json
```

Render free web service se sleep khi idle va khong co persistent disk. De chay 24/7 va giu du lieu update, dung paid instance type nhu `starter` voi persistent disk nhu file `render.yaml`.

## Import CSV

```powershell
npm run import:csv -- "D:\KICET\Optuna\PHYSBO\PHYSBO+Input Physic\DiamondGrowthHetero.csv"
```

## Vi du

Tao item:

```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:3000/items -ContentType 'application/json' -Body '{"data":{"name":"sensor-1","value":10}}'
```

Cap nhat item:

```powershell
Invoke-RestMethod -Method PATCH -Uri http://localhost:3000/items/<id> -ContentType 'application/json' -Body '{"value":11}'
```

Gui mot update tuy bien:

```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:3000/updates -ContentType 'application/json' -Body '{"type":"sensor.tick","data":{"value":12}}'
```

Lang nghe update lien tuc bang JavaScript:

```js
const events = new EventSource("http://localhost:3000/stream");

events.addEventListener("update", (event) => {
  console.log(JSON.parse(event.data));
});
```
