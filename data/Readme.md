# Event Data

Each event folder follows the `data/covh/` split-file standard:

- `event.json`
- `locations.json`
- `schedule.json`
- `vendors.json`
- `flyer.json`

HTML pages should point to the folder `event.json` entry file. The app loader reads `_split` in that file and loads the related files automatically.
