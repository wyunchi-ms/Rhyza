export type AppTheme = "light" | "dark";
export type ArchifyViewerMode = "inline" | "expanded";

const viewerStyles = `
  html[data-rhyza-mode="inline"],
  html[data-rhyza-mode="inline"] body {
    overflow: hidden !important;
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
  }
  html[data-rhyza-mode="inline"]::-webkit-scrollbar,
  html[data-rhyza-mode="inline"] body::-webkit-scrollbar { display: none !important; }
  html[data-rhyza-viewer] .toolbar > :not(.export-wrap) { display: none !important; }
  html[data-rhyza-viewer] .toolbar .export-menu-section:has(button[data-format="share-card"]) { display: none !important; }
  html[data-rhyza-viewer] .toolbar #btn-export {
    min-height: 2rem;
    border-radius: 6px;
    padding: 0.35rem 0.65rem;
    font-size: 0.72rem;
    font-weight: 650;
  }
  html[data-rhyza-viewer] .pulse-dot {
    width: 12px !important;
    height: 12px !important;
    min-width: 12px !important;
    flex: 0 0 12px !important;
    aspect-ratio: 1 / 1;
    border-radius: 50% !important;
  }
  html[data-rhyza-viewer] .header { padding-right: 6rem !important; }
  html[data-rhyza-viewer] .header-row { min-width: 0; flex-wrap: nowrap !important; }
  html[data-rhyza-viewer] .header-row h1 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: clamp(0.88rem, 2.15vw, 1.5rem) !important;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  html[data-rhyza-mode="inline"],
  html[data-rhyza-mode="inline"] body { min-height: 0 !important; }
  html[data-rhyza-mode="inline"] body { padding: 1rem !important; }
  html[data-rhyza-mode="inline"] .toolbar { top: 0.5rem !important; right: 3.25rem !important; }
  html[data-rhyza-mode="inline"] .header { padding-right: 8.5rem !important; }
  html[data-rhyza-mode="inline"] .cards,
  html[data-rhyza-mode="inline"] .guided-views,
  html[data-rhyza-mode="inline"] .route-probe,
  html[data-rhyza-mode="inline"] .overview-map,
  html[data-rhyza-mode="inline"] .overview-map-feedback,
  html[data-rhyza-mode="inline"] .semantic-lens,
  html[data-rhyza-mode="inline"] .focus-chip,
  html[data-rhyza-mode="inline"] .diagram-guide,
  html[data-rhyza-mode="inline"] .node-finder,
  html[data-rhyza-mode="inline"] #btn-route-probe,
  html[data-rhyza-mode="inline"] #btn-overview-map,
  html[data-rhyza-mode="inline"] #btn-semantic-lens,
  html[data-rhyza-mode="inline"] #btn-node-finder,
  html[data-rhyza-mode="inline"] #btn-diagram-guide { display: none !important; }
`;

export function prepareArchifyViewerHtml(
	html: string,
	options: { theme: AppTheme; mode: ArchifyViewerMode },
): string {
	const rootAttributes = `data-rhyza-viewer="true" data-rhyza-mode="${options.mode}" data-theme="${options.theme}" data-preset="classic"`;
	let prepared = html.replace(/<html\b[^>]*>/i, (tag) => {
		const withoutControlledAttributes = tag
			.replace(/\sdata-rhyza-viewer=(?:"[^"]*"|'[^']*')/gi, "")
			.replace(/\sdata-rhyza-mode=(?:"[^"]*"|'[^']*')/gi, "")
			.replace(/\sdata-theme=(?:"[^"]*"|'[^']*')/gi, "")
			.replace(/\sdata-preset=(?:"[^"]*"|'[^']*')/gi, "")
			.replace(/>$/, "");
		return `${withoutControlledAttributes} ${rootAttributes}>`;
	});

	prepared = prepared.replace(/<\/head>/i, `<style id="rhyza-archify-viewer">${viewerStyles}</style>\n</head>`);
	const hostConfig = `<script id="rhyza-archify-host">(function(){var root=document.documentElement;var theme=${JSON.stringify(options.theme)};var mode=${JSON.stringify(options.mode)};var reportQueued=false;function reportSize(){if(mode!=='inline'||reportQueued)return;reportQueued=true;requestAnimationFrame(function(){reportQueued=false;var body=document.body;var height=Math.ceil(Math.max(root.scrollHeight,root.offsetHeight,body?body.scrollHeight:0,body?body.offsetHeight:0));if(height>0)parent.postMessage({type:'rhyza:archify-size',mode:mode,height:height},'*');});}function enforce(){if(root.getAttribute('data-theme')!==theme)root.setAttribute('data-theme',theme);if(root.getAttribute('data-preset')!=='classic')root.setAttribute('data-preset','classic');if(root.getAttribute('data-rhyza-mode')!==mode)root.setAttribute('data-rhyza-mode',mode);root.setAttribute('data-rhyza-viewer','true');root.removeAttribute('data-present');}enforce();if(typeof MutationObserver==='function'){new MutationObserver(enforce).observe(root,{attributes:true,attributeFilter:['data-theme','data-preset','data-rhyza-mode','data-present']});}if(mode==='inline'){window.addEventListener('load',reportSize,{once:true});window.addEventListener('message',function(event){if(event.data&&event.data.type==='rhyza:archify-measure')reportSize();});if(document.fonts&&document.fonts.ready)document.fonts.ready.then(reportSize).catch(function(){});setTimeout(reportSize,250);setTimeout(reportSize,700);}})();</script>`;
	return prepared.replace(/<\/body>/i, `${hostConfig}\n</body>`);
}
