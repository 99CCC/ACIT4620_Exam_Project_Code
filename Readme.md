# ACIT4620 Exam Project - Group D1 2025 Fall
Authors:
- Carl Christian Roll-Lund
- Vera Eines Ertsås
- Davyd Lebedovskyi
- Simen Strålberg

## Repository Structure
The repository has 2 main logical sections:

### /Extraction
Scripts written in TypeScript, downloads data from GTFS via Entur, Enturs JourneyPlanner API and Kartverkets API for polygon maps used for filtering.

Any data needed for use in the modelling section is already present in the uploaded folders structure. If one wishes to grab fresh data from GTFS, one needs to run the /Extraction/src/GTFS.ts

Prereqs:
- [Node 22+](https://nodejs.org/en) with NPM or any preffered package manager
- Then use your package manager to install typescript
```bash
npm install typescript
```   
- Next either open the terminal from /Extraction/src or write the full path inline, then run these three commands
```bash
npm install
tsc
node /dist/GTFS.js
```
Short explanation: Typescript transpiles down to JavaScript, and we run the JS file with Node, the npm install given that it is done within the src dir will use the package.json to install needed dependencies. We went for this old but simple transpile-compile setup, due to personal preferance.    

After running the GTFS.js once, a re-run will not retrigger a new GTFS download and will simply retrigger a fresh CSV, do trigger a re-download of the GTFS simply delete the cached GTFS zip which can be found in /out after 1 run.

### Modelling
The modelling section was split up across group members to allow for individualized contributions

Prereqs:
- [Python 3.10+](https://www.python.org/downloads/)
- [JupyterLab (for running the notebooks)](https://jupyter.org/install)

Each group member was instructed to implement a requirements.txt within their folder as we failed to find time to adjust the preliminary folder structure, and also decided against it as we didnt want anything to break due to filepaths changing,
therefore the best way to explore the notebooks is to change directory into the Author Name folder you'd like to inspect and run Jupyter lab, opening up a browser with the workbook, or simply viewing them in [GitHub](https://github.com/99CCC/ACIT4620_Exam_Project_Code) as it renders workbooks quite nicely.


To install python requirements from the .txt files run:
```bash
pip install -r requirements.txt
```

The link between the report and the repository are as following:
- Maximum-Flow & Robustness Simulation
```bash
cd .\Modeling\Carl\
jupyter lab
```
- Bus Analysis
```bash
cd .\Modeling\Davyd\
jupyter lab
```
- Railway Overhead Analysis
```bash
cd .\Modeling\Davyd\
jupyter lab
```
- Data Foundation Analysis
```bash
cd .\Modeling\Simen\
jupyter lab
```