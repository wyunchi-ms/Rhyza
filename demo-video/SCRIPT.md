# Rhyza Mini Hackathon Demo

Target: 2 minutes, 16:9, Mandarin narration, Simplified Chinese captions.

Voiceover: Azure AI Speech, `zh-CN-XiaoxiaoNeural`, `+16%`, East Asia. Credentials are read from the active Azure PowerShell subscription at generation time and are never stored in this project.

## Narration

想象一下，你刚接手一个项目，里面有太多陌生的概念。你开始和 Agent 聊天：先问一个问题，回答里又出现五个值得追问的方向。你追问其中两个，它们又各自带来更多问题。几轮之后，问题数量开始失控。有些想问的问题被淹没了；隔了几轮，你甚至又问了一遍之前问过的问题。答案越来越多，你却越来越难判断自己还不知道什么。

Rhyza 把分散的对话组织成清晰的工作脉络，让用户直观看到：已经理解什么、还有哪些问题、下一步该推进什么，减少遗漏和重复，提高知识工作的效率。

材料不限定于代码。Sources 可以加入代码、文档、笔记、论文，甚至一本书。Agent 会搜索这些本地内容，再回答问题。

每次对话都是工作脉络中的节点。出现新的问题方向时，可以从当前回答直接分叉。每条分支拥有独立上下文，节点可以标记为待处理、进行中、已完成或搁置。

独立分支也会减少无关上下文，让 Agent 聚焦当前问题，降低历史信息干扰，有助于提高回答精度并减少 Token 消耗。

这样，我能快速看到哪些问题仍待处理，也能在几天后回到原来的位置，沿着原有上下文继续推进。

回答中的实体、关系和图表会沉淀到知识图谱。已有实体再次出现时，会自动链接到对应知识，帮助我识别重复问题，并看到知识之间的关系。这些结构化知识也能成为后续分析、决策和内容产出的上下文。

Rhyza 把分叉的问题转化为可管理的工作脉络，把对话积累为可复用的知识。它让我少走重复的路，快速定位未完成的问题，也为个人和团队后续的工作保留上下文。最终，用更少的时间和 Token，更高效地完成知识工作。

## Storyboard

| Time | Scene | Visual | On-screen point |
| --- | --- | --- | --- |
| 00:00-00:28 | Question explosion in linear chat | A new project produces unfamiliar concepts. One answer creates five follow-ups; two are pursued and create more. Unasked questions are lost below the fold, then a previously answered question is asked again. | `Questions multiply` / `3 missed` / `1 repeated` |
| 00:28-00:41 | Product purpose | The failed linear transcript reorganizes into the Rhyza work map. Three columns appear: known, unknown, next. | `Turn questions into working knowledge` / `See what remains` |
| 00:41-00:50 | Any source, not only code | Sources receives code, documents, notes, papers, and book material; search/read connects the collection to the Agent. | `Work from any local source` |
| 00:50-01:04 | Branch and track | A session node forks into sibling questions; status markers appear and an unresolved branch is highlighted. | `Branch from any answer` / `Track what remains` |
| 01:04-01:13 | Focused context | Compare a linear chat sending every prior turn to the Agent with a branch sending only its relevant path. Irrelevant blocks fall away and the context meter contracts. | `Less noise` / `More focused answers` / `Fewer tokens` |
| 01:13-01:38 | Knowledge continuity | A saved branch resumes from its prior context. Entities, relations, and diagrams enter the knowledge graph; repeated knowledge links to its existing card and remains available for future analysis and output. | `Continue the work` / `Reuse knowledge and context` |
| 01:38-02:00 | Efficiency payoff | The question tree and knowledge graph become one navigable work map; unresolved count reaches zero and reusable knowledge remains. | `Move work forward. Keep the knowledge.` |

## Animation Script A: Question Explosion (00:00-00:28)

| Time | Animation | Purpose |
| --- | --- | --- |
| 00:00-00:04 | A project folder lands in the center. Labels such as `Authentication`, `Sessions`, `Storage`, and `Agent Loop` emerge around it with question marks. The camera moves closer as the labels fill the frame. | Establish a newly inherited project with many unknowns. |
| 00:04-00:09 | A minimal chat opens. The user asks one concrete question: `How does authentication work?` The Agent answer arrives, and five follow-up chips animate out of highlighted phrases: `Token storage`, `Device flow`, `Session restore`, `Provider state`, `Error handling`. | Make one answer visibly create five new questions. |
| 00:09-00:14 | The user selects `Token storage` and `Device flow`. Each chip expands into a new chat turn and produces three more follow-up chips. A small counter changes from `1 question` to `5` and then `11`. | Show compounding growth rather than merely describing it. |
| 00:14-00:19 | The two handled chips receive check marks. The remaining original chips move downward as new chat messages push them below the viewport. `Session restore` briefly pulses amber, then disappears below the fold. | Demonstrate an intended question being forgotten. |
| 00:19-00:24 | The transcript fast-forwards through several turns. The user asks `Where is the token stored?` again. The identical earlier question flashes in the faded history and a dotted red line connects both turns. A `Repeated` label appears. | Demonstrate duplicate questioning after several rounds. |
| 00:24-00:28 | Camera zooms out to a very long linear transcript. Two compact counters lock beside it: `3 missed` and `1 repeated`. The transcript then bends into the first branches of a tree for the next scene transition. | Summarize the cost and transition into Rhyza. |

Visual rule: keep only one branch accent color at first. Use amber for unanswered questions and muted red only for the duplicate event. Counters must be large enough to read at 1080p; do not rely on tiny transcript text.

## Animation Script B: Focused Branch Context (01:04-01:13)

| Time | Animation | Purpose |
| --- | --- | --- |
| 01:04-01:06 | Split screen. On the left, a linear chat stacks eight mixed-topic message blocks and sends the entire stack toward an Agent icon. A context bar fills nearly edge to edge; unrelated blocks are gray but remain included. | Visualize the baseline: every previous topic competes for context. |
| 01:06-01:08 | The Agent tries to answer the active blue question while gray fragments drift across it. The answer target looks slightly blurred. Labels appear: `Relevant context` and `Unrelated history`. | Explain interference without claiming a numeric accuracy gain. |
| 01:08-01:11 | On the right, the same conversation reorganizes into a tree. The active root-to-leaf path lights up; sibling branches fade back. Only the highlighted path flows into the Agent, and the context bar becomes visibly shorter. | Show that a branch carries the relevant path, not the whole transcript. |
| 01:11-01:13 | The answer target snaps into focus. Three short labels resolve in sequence: `Less noise`, `More focused`, `Fewer tokens`. The right-hand branch expands to full screen for the knowledge scene. | Convert the mechanism into clear user value. |

Visual rule: use relative bars rather than invented token counts or accuracy percentages. The comparison should communicate direction, not unsupported benchmarks.

## Demo Notes

- Start with the follow-up-question explosion, not installation, authentication, or implementation details.
- Keep one visible example question throughout so the audience can follow how it branches.
- Show clearly that a workspace may contain code, documents, notes, papers, or book material.
- Make unfinished status and returning to an earlier branch the main interaction, not a secondary feature.
- Present the knowledge graph as memory for stable concepts and relationships, not as automatic extraction of every noun.
- Do not claim semantic embeddings: the current source index is a local text index exposed through Agent tools.
- End on moving the work forward without losing earlier questions or accumulated knowledge.
