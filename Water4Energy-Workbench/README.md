# Water4Energy workbench · v0.15.1

A project interface for explaining how weather-model research informs water and energy questions. It opens on **HEADWATER development**, keeps chat on the left, and places the selected workflow or evidence on the right. [VISTA](https://github.com/Genesis-VISTA/vista) supplies the agent, project storage and model connection.

## Launch this repository checkout

1. Open **Water4Energy-Workbench**.
2. Double-click **Start TVA Workbench.command** on macOS. Keep its Terminal window open. Windows uses **Start TVA Workbench.bat**; Linux uses `sh start.sh`.
3. Follow the local URL printed by the launcher. It selects an available port if another version is already running.

Python 3.9+ is required; the Mac launcher can use VISTA's bundled Python. No frontend build, npm install or pip install is needed. Terminal users can run `python3 server.py --no-browser`.

This public checkout is the **interface source distribution**. It opens without creating or changing a VISTA project. For live conversation, open VISTA, configure your own model provider, and use **Connection settings** to connect to `http://127.0.0.1:8001` and project **Water4Energy-TVA-agent-loop**. Missing skills and saved figures are reported in the interface.

The authorized combined ZIP remains the supported way to install the saved-evidence backend: extract that complete ZIP and use its single launcher. This repository does not include private research snapshots, skill reference bundles, migration archives, evidence archives, paper PDFs or credentials. Do not copy those materials into a public commit. An unmanifested local backend folder is not automatically installed. See [VISTA_SETUP.md](VISTA_SETUP.md) for the project and evidence contracts.

## Follow the workflow

| Screen | Purpose |
| --- | --- |
| **HEADWATER development** | Introduce the question, prepared data, experiment design, recorded execution, scores and a separate downscaling example. |
| **Hypothesis lab** | Explore the ledger, Proposer, Critic, Referee, human review and evidence using the completed October example. |
| **TVA case** | Introduce the study network and open the 16–22 April 2019 case. |
| **Case Lab** | Ask an editable starter question and inspect figures beside the conversation. |
| **Results Library / Literature library** | Browse output files and source references in compact lists. |
| **Skills & sources / Compute / Connection settings** | Inspect the connected project and its resources. |

HEADWATER, the October worked example and the April TVA case keep separate conversations and unsent drafts. Changing context during a running turn is blocked. The same chat column remains on the left when moving between the development, method and Case Lab screens. Starter controls prepare an editable request; a person presses **Send**. They do not start a job or grant execution approval.

The evidence workspace follows actual displayed files and preserves a manually selected figure until **Resume following** is chosen. Drag **Adjust message box** up or down to resize the composer. Malformed provider tool replies are shown as incomplete answers and can be retried only by the person. The **Powered by VISTA** credit links to the VISTA project.

The ORNL and Genesis marks, navy-and-green theme, compact libraries, 12 distinguished headwater reservoirs, optional dam panel, launcher filenames and VISTA project identity are retained. The dam readout remains optional and needs an agreed reservoir rule.

## Evidence and scope

The development and October explanations in this public source distribution use the [public project summary](../Water4Energy_workbench.md) and [action record](../Water4Energy_Workbench_Actions_20261112.md). Detailed proposal, review and approval records are read from an authorized local backend when available. The public cards do not reconstruct private review thresholds or approval receipts.

The temperature result belongs to the **H100 / CCSI 9×9** model: about **0.77°C** error versus **0.86°C** for **the 1979–2017 week already in the example files**, across four saved 2019 target weeks. Lux lists run names without borrowing that score. Temperature errors are not air temperatures, and a retrospective record grants no permission for a new run.

The five supplied PNG figures retain their upstream bytes and pinned provenance. The monthly April 2019 refinement maps summarize 30 days at about 4 km; the TVA case's frozen Trial 0 comparison is a separate weekly example at 0.25°. The monthly maps do not establish a connected HEADWATER forecasting-to-downscaling pipeline. The April runoff panel describes observed ERA5 surface runoff; a runoff forecast remains unavailable. Video, captions and an approved home-score image are optional local assets.

## Development and checks

The UI uses vanilla HTML/CSS/JavaScript and a Python standard-library server. Browser calls use its scoped local VISTA adapter. VISTA owns model credentials, conversations and outputs; ignored `.local/` stores only this interface's local connection/runtime state.

```sh
python3 -m unittest discover -s tests -v
node --test tests/*.cjs
```

Node is needed only for developer checks. Installer tests use an isolated fake VISTA and synthetic fixtures; they do not contact the live science backend. The release builder requires the authorized complete backend payload before building an all-in-one archive. See [VERIFICATION.md](VERIFICATION.md) for checks on this integration.
