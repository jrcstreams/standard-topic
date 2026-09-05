import{B as nt,C as me,D as it,E as be,H as ot,J as ve,h as Qe,j as Ze,k as Ke,q as se,r as qe,s as Te,t as _,u as et,v as tt,w as Pe}from"./chunk.SUKDFL6A.js";var s={step:0,values:{},customValues:{},extraInputs:{},modelId:null,customizations:"",visited:new Set};function ze(){return{values:JSON.parse(JSON.stringify(s.values||{})),customValues:JSON.parse(JSON.stringify(s.customValues||{})),extraInputs:JSON.parse(JSON.stringify(s.extraInputs||{})),customizations:s.customizations||""}}function le(e){e&&(s.values=JSON.parse(JSON.stringify(e.values)),s.customValues=JSON.parse(JSON.stringify(e.customValues)),s.extraInputs=JSON.parse(JSON.stringify(e.extraInputs)),s.customizations=e.customizations)}var G=null,He=null,ut=[],U=null,L=null,ie=[],gt='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';function _e(e){ie.push(e),e()}function de(){ie.length>1&&ie.pop();let e=ie[ie.length-1];e&&e()}function Fe({title:e,footer:t=!0,doneLabel:n="Done",onDone:a,onCancel:i}){L.innerHTML=`
    <div class="pb-inline-view">
      <button type="button" class="prompts-back pb-inline-back" data-pb-back>${gt}<span>Back</span></button>
      ${e?`<h2 class="pb-inline-title">${u(e)}</h2>`:""}
      <div class="pb-inline-body" data-pb-body></div>
      ${t?`<div class="pb-inline-foot">
        <button type="button" class="pb-inline-ghost" data-pb-cancel>Cancel</button>
        <button type="button" class="pb-inline-cta" data-pb-done>${u(n)}</button>
      </div>`:""}
    </div>`;let o=()=>{i&&i(),de()};return L.querySelector("[data-pb-back]").addEventListener("click",o),L.querySelector("[data-pb-cancel]")?.addEventListener("click",o),L.querySelector("[data-pb-done]")?.addEventListener("click",()=>{a&&a(),de()}),L.querySelector("[data-pb-body]")}function on(){return J()}var fe=null;function sn(e,t={}){G=et(),He=se(),U=e,L=t.inline?e:null,ie=t.inline?[Se]:[],F=null,L&&e.classList.add("pb-inline"),s.step=0,s.values={},s.customValues={},s.extraInputs={},s.modelId=nt(Te()),s.customizations="",s.visited=new Set([0]),ut=kt(),Se(),fe&&window.removeEventListener("resize",fe),fe=()=>{},window.addEventListener("resize",fe,{passive:!0})}function kt(){return[{id:"topic",label:"Topic",icon:"\u{1F3AF}",title:"What do you want to learn about?",description:"Choose one or more primary topics. Add secondary topics to blend ideas.",required:!0,render:ke,isComplete:()=>D().length>0},{id:"content",label:"Content",icon:"\u{1F4CB}",title:"What kind of content do you want?",description:"Content type, approach, sources, recency, and citations \u2014 all in one place.",render:Rt},{id:"style",label:"Style",icon:"\u{1F3A8}",title:"How should it be written?",description:"Format, length, audience, tone, region, and any custom instructions.",render:Nt},{id:"review",label:"Review",icon:"\u2713",title:"Review your prompt and choose a model",description:"Edit the model and submit when ready.",isFinal:!0,render:Oe}]}var zt={overview:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="1.5"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="10" y1="12" x2="14" y2="12"/><line x1="10" y1="16" x2="13" y2="16"/></svg>',"research-summary":'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="20" x2="20" y2="20"/><rect x="5" y="11" width="3" height="9"/><rect x="10.5" y="6" width="3" height="14"/><rect x="16" y="14" width="3" height="6"/></svg>',explainer:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14A6 6 0 1 0 8.91 14a4 4 0 0 1 1.41 2.39h3.36A4 4 0 0 1 15.09 14z"/></svg>',comparison:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="7" height="14" rx="1"/><rect x="14" y="5" width="7" height="14" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',timeline:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><circle cx="7" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="17" cy="12" r="2"/></svg>',"case-study":'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><line x1="21" y1="21" x2="15.65" y2="15.65"/></svg>',analysis:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>',forecast:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 12 8 7 12 11 21 4"/><polyline points="14 4 21 4 21 11"/></svg>'},xt='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',$t='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',Et='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';function Ce(e){return G.fields.find(t=>t.key===e)}function Y(e){return Ce(e)?.options||[]}function St(e){return Ce(e)?.description||""}function Ge(e){return!0}function pt(e){return!!Ce(e)?.allowCustom}function W(e){let t=s.values[e];return Array.isArray(t)?t:t?[t]:[]}function ee(e,t){return W(e).includes(t)}function Re(e,t){if(Ge(e)){let n=[...W(e)],a=n.indexOf(t);a>=0?n.splice(a,1):n.push(t),n.length===0?delete s.values[e]:s.values[e]=n}else s.values[e]===t?delete s.values[e]:s.values[e]=t}function mt(e,t){let n=(t||"").trim();if(!n)return;let a=`c${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`;s.customValues[e]||(s.customValues[e]={}),s.customValues[e][a]=n,Ge(e)?s.values[e]=[...W(e),a]:s.values[e]=a}function bt(e,t){if(Ge(e)){let n=W(e).filter(a=>a!==t);n.length===0?delete s.values[e]:s.values[e]=n}else s.values[e]===t&&delete s.values[e];s.customValues[e]&&t in s.customValues[e]&&delete s.customValues[e][t]}function xe(e,t){return s.customValues[e]?.[t]}function st(e,t,n){let i=e.classList.contains("wiz-card")?"wiz-card-remove":"wiz-chip-remove",o=e.querySelector("."+i);if(n&&!o){let r=document.createElement("span");r.className=i,r.setAttribute("data-remove",t),r.setAttribute("aria-label","Remove"),r.textContent="\xD7",e.appendChild(r)}else!n&&o&&o.remove()}var he=null;function $e(){he&&cancelAnimationFrame(he),he=requestAnimationFrame(()=>{he=null,V(),X()})}function X(){let e=document.getElementById("wiz-restart");if(!e)return;let t=Object.keys(s.values||{}).length===0&&!s.customizations&&Object.keys(s.customValues||{}).length===0&&Object.keys(s.extraInputs||{}).length===0&&!s.editedPrompt,n=document.getElementById("wiz-submit-prompt");n&&(n.disabled=!1,n.classList.remove("is-empty"),n.classList.add("is-ready")),e.disabled=t;let a=document.getElementById("wiz-export-prompt");a&&(a.disabled=t)}function D(){let e=s.values.primaryTopic;return Array.isArray(e)?e.filter(t=>typeof t=="string"&&t.trim()):typeof e=="string"&&e.trim()?[e.trim()]:[]}function te(){let e=s.values.secondaryTopic;return Array.isArray(e)?e.filter(t=>typeof t=="string"&&t.trim()):typeof e=="string"&&e.trim()?[e.trim()]:[]}function vt(e,t){let n=(e==="primaryTopic"?D():te()).filter(a=>a!==t);n.length===0?delete s.values[e]:s.values[e]=n}var Lt='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',ye={send:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',eye:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',download:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',clear:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'},pe=[{key:"topics",label:"Topics",desc:"What this prompt should focus on.",fields:["primaryTopic","secondaryTopic"],required:!0},{key:"output",label:"Output Style",desc:"Type, reasoning, format, length, and tone.",fields:["outputType","reasoning","format","length","audience","tone"]},{key:"sources",label:"Sources & Citations",desc:"References and how to cite them.",fields:["sources","citations"]},{key:"scope",label:"Scope",desc:"Time window and geographic focus.",fields:["recency","geographic"]},{key:"custom",label:"Custom Instructions",desc:"Framing, exclusions, extra detail.",fields:["customizations"]},{key:"model",label:"Choose Model",desc:"The AI model this prompt will be sent to.",fields:[]}];function ft(e){if(e)try{let t=e.getBoundingClientRect();if(t.top>=70&&t.top<=220)return;e.scrollIntoView({block:"start",behavior:"smooth"})}catch{}}function Ct(e,t){let n=G.fields?.find(i=>i.key===e);return n?.options&&n.options.find(i=>(i.value||i.id)===t)?.label||t}function qt(e){return G.fields?.find(t=>t.key===e)?.label||e}function Ue(e){let t=[];if(e.key==="model"){let n=_(s.modelId);return n&&t.push({label:"Selected model",values:[n.name]}),t}for(let n of e.fields)if(n==="primaryTopic"){let a=D();a.length&&t.push({label:"Primary topic(s)",values:a.slice()})}else if(n==="secondaryTopic"){let a=te();a.length&&t.push({label:"Secondary topic(s)",values:a.slice()})}else if(n==="customizations"){let a=(s.customizations||"").trim();a&&t.push({label:"Custom instructions",custom:a})}else{let a=s.values?.[n],i=Array.isArray(a)?a:a?[a]:[];i.length&&t.push({label:qt(n),values:i.map(o=>Ct(n,o))})}return t}function ht(e){let t=`<span class="pb-card-sumlabel">${u(e.label)}:</span>`;if(e.custom){let n=e.custom.length>150,a=u(n?e.custom.slice(0,150).trimEnd()+"\u2026":e.custom);return`<div class="pb-card-sumrow pb-card-sumrow--custom">${t} <span class="pb-card-sumtext">${a}${n?' <span class="pb-card-sum-more">view more</span>':""}</span></div>`}return e.values.length===1?`<div class="pb-card-sumrow">${t} <span class="pb-card-sumvals">${u(e.values[0])}</span></div>`:`<div class="pb-card-sumrow pb-card-sumrow--list">${t}<ul class="pb-card-sumlist">${e.values.map(n=>`<li>${u(n)}</li>`).join("")}</ul></div>`}function yt(){return pe.map((e,t)=>{let n=Ue(e),a=n.length?`<div class="pb-card-summary">${n.map(ht).join("")}</div>`:"",i=n,o=e.required?'<span class="pb-card-req">Required</span>':"";return`
      <button type="button" class="pb-card${i.length?" has-items":""}" data-pb-card="${e.key}">
        <span class="pb-card-num" aria-hidden="true">${t+1}</span>
        ${i.length?'<span class="pb-card-done" aria-label="Configured"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></span>':""}
        <span class="pb-card-tx">
          <span class="pb-card-titlerow"><span class="pb-card-title">${u(e.label)}</span>${o}</span>
          <span class="pb-card-desc">${u(e.desc)}</span>
          ${a}
        </span>
        <span class="pb-card-chev" aria-hidden="true">${Lt}</span>
      </button>
    `}).join("")}function Ne(){let e=document.getElementById("pb-card-grid");e&&(e.innerHTML=yt()),document.querySelectorAll(".pb-card").forEach(t=>{t.addEventListener("click",()=>{L?Je(t,t.dataset.pbCard):Ee(t.dataset.pbCard)})}),V(),X()}function Ee(e){let t=pe.find(c=>c.key===e);if(!t)return;if(L){let c=ze();return _e(()=>Tt(t,c))}let n=document.createElement("div");n.className="pb-modal-overlay",n.setAttribute("role","dialog"),n.setAttribute("aria-label",t.label),document.body.appendChild(n),n.innerHTML=`
    <div class="pb-modal-card">
      <header class="pb-modal-head">
        <button type="button" class="pb-modal-close" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18"/>
            <line x1="18" y1="6" x2="6" y2="18"/>
          </svg>
        </button>
        <h2 class="pb-modal-title">${u(t.label)}</h2>
      </header>
      <div class="pb-modal-body" id="pb-modal-body"></div>
      <footer class="pb-modal-foot">
        <button type="button" class="pb-modal-cancel">Cancel</button>
        <button type="button" class="pb-modal-done">Done</button>
      </footer>
    </div>
  `;let a=n.querySelector("#pb-modal-body"),i=ze(),o=()=>{n.remove(),Ne()},r=()=>{le(i),o()};n.querySelector(".pb-modal-close").addEventListener("click",r),n.querySelector(".pb-modal-done").addEventListener("click",o),n.querySelector(".pb-modal-cancel").addEventListener("click",r),n.addEventListener("click",c=>{c.target===n&&r()}),We(t,a)}function We(e,t){let n=e.key;if(n==="model"){At(t);return}if(n==="topics"){wt(t);return}if(n==="custom"){t.innerHTML=`
      <p class="pb-modal-desc">Add any extra instructions \u2014 specific framing, exclusions, or detail you'd like the AI to focus on.</p>
      <textarea class="pb-modal-textarea" placeholder="Anything else to add..." id="pb-modal-custom">${u(s.customizations||"")}</textarea>
    `,t.querySelector("#pb-modal-custom").addEventListener("input",a=>{s.customizations=a.target.value});return}t.innerHTML=e.fields.map(a=>`
    <section class="pb-modal-section">
      <h3 class="pb-modal-section-title">${u(Bt(a))}</h3>
      <p class="pb-modal-section-desc">${u(St(a))}</p>
      <div data-field="${a}"></div>
      <div class="wiz-extras" data-extras-field="${a}"></div>
    </section>
  `).join(""),e.fields.forEach(a=>{let i=t.querySelector(`[data-field="${a}"]`);if(!i)return;O(i,a);let o=t.querySelector(`[data-extras-field="${a}"]`);o&&K(o,a)})}function Tt(e,t){let n=Fe({title:e.label,onCancel:()=>le(t),onDone:()=>{}});We(e,n)}function Pt(){let e=document.querySelector('.pb-card[data-pb-card="model"]');if(!e)return;let t=Ue(pe.find(i=>i.key==="model")),n=t.length?t.map(ht).join(""):"",a=e.querySelector(".pb-card-summary");if(a)a.innerHTML=n;else if(n){a=document.createElement("div"),a.className="pb-card-summary",a.innerHTML=n;let i=e.querySelector(".pb-card-tx")||e;i.insertBefore(a,i.querySelector(".pb-card-config")||null)}}function At(e){let t=se()||[],n='<svg class="pm-model-check" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',a=t.map(o=>`<button class="pm-model" type="button" data-model-id="${z(o.id)}" aria-pressed="${o.id===s.modelId?"true":"false"}">${n}<span class="pm-model-name">${u(o.name)}</span></button>`).join("");e.innerHTML=`<div class="pm-models pm-models--pick">${a}</div><div class="pm-model-foot"><button type="button" class="pm-reset" data-pm-reset>Reset to default</button></div>`;let i=o=>{if(!o)return;s.modelId=o,me(o),e.querySelectorAll(".pm-model").forEach(c=>c.setAttribute("aria-pressed",c.dataset.modelId===o?"true":"false")),Ye(),Pt();let r=document.getElementById("wiz-preview-drawer");r&&!r.hidden&&F===r&&Z(),V(),X()};e.addEventListener("click",o=>{let r=o.target.closest("[data-model-id]");if(r){i(r.dataset.modelId);return}o.target.closest("[data-pm-reset]")&&i(Te())})}function wt(e){let t=()=>wt(e),n=(o,r,c)=>`
    <section class="pb-modal-section">
      <h3 class="pb-modal-section-title">${o}</h3>
      <div class="wiz-topic-chips" data-pb-topic-key="${c}" id="pb-topicbar-${c}">
        ${r.map(l=>`
          <span class="wiz-inline-chip" data-remove="${z(l)}">
            ${u(l)}
            <button type="button" class="wiz-inline-chip-x" aria-label="Remove">\xD7</button>
          </span>
        `).join("")}
        <button type="button" class="wiz-topic-add-inline" data-browse="${c}">${r.length?"+ Add more":"+ Select"}</button>
      </div>
    </section>
  `;e.innerHTML=`
    ${n('Primary Topic(s) <span class="pb-req-tag">Required</span>',D(),"primaryTopic")}
    ${n('Secondary Topic(s) <span class="pb-optional-tag">Optional</span>',te(),"secondaryTopic")}
  `,e.querySelectorAll(".wiz-inline-chip-x").forEach(o=>{o.addEventListener("click",r=>{r.stopPropagation();let c=o.closest(".wiz-inline-chip"),l=c.closest(".wiz-topic-chips").dataset.pbTopicKey;vt(l,c.dataset.remove),t()})});let a=!!(L&&U&&U.querySelector(".pb-card.is-expanded")),i=o=>{let r=o==="primaryTopic"?D():te(),c=o==="primaryTopic"?"Add Primary Topics":"Add Secondary Topics",l=d=>{s.values[o]=d,d.length===0&&delete s.values[o],t()};if(a){let d=e.querySelector(`#pb-topicbar-${o}`).closest(".pb-modal-section"),v=d.querySelector(".pb-nested-picker");if(e.querySelectorAll(".pb-nested-picker").forEach(y=>y.remove()),v)return;let p=document.createElement("div");p.className="pb-nested-picker",d.appendChild(p),at(c,r,l,{container:p,onClose:()=>t()}),requestAnimationFrame(()=>ft(d))}else at(c,r,l)};e.querySelectorAll(".wiz-topic-chips").forEach(o=>{o.addEventListener("click",r=>{r.target.closest(".wiz-inline-chip-x")||i(o.dataset.pbTopicKey)})})}var It='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';function ce(e){return`<span class="pb-acc-check ${e?"is-checked":""}" aria-hidden="true">${e?It:""}</span>`}var P=null;function at(e,t,n,a){let i=a&&a.container,o=!i&&!!L;!o&&!i&&P&&(P.remove(),P=null);let r=new Set(t||[]),c=null,l="",d,v,p,y=()=>{if(i){a&&a.onClose&&a.onClose();return}if(o){de();return}P?.remove(),P=null},g=()=>{n(Array.from(r)),y()},w=m=>{let b=(m||"").trim();b&&(r.has(b)?r.delete(b):r.add(b),f())};function q(){return r.size===0?"":`
      <div class="pb-acc-selected">
        ${Array.from(r).map(m=>`
          <span class="pb-acc-selchip" data-acc-remove="${z(m)}">
            ${u(m)}
            <button type="button" class="pb-acc-selchip-x" aria-label="Remove">\xD7</button>
          </span>
        `).join("")}
      </div>
    `}function x(){return`
      <div class="pb-modal-section-desc" style="margin-bottom: 0.6rem;">Tap a topic to expand it, then pick the parent or any subtopic.</div>
      <div class="pb-acc-list">
        ${tt().map(b=>{let k=c===b.parent.slug,T=r.has(b.parent.name);return`
            <div class="pb-acc-card ${k?"is-open":""}${T?" is-selected":""}">
              <button type="button" class="pb-acc-head" data-acc-expand="${b.parent.slug}" aria-expanded="${k?"true":"false"}">
                <span class="pb-acc-icon">${ot(b.parent.icon||"globe","")}</span>
                <span class="pb-acc-name">${u(b.parent.name)}</span>
                ${T?'<span class="pb-acc-tick" aria-hidden="true">\u2713</span>':""}
                <span class="pb-acc-chev" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 4.5 6 7.5 9 4.5"/></svg>
                </span>
              </button>
              <div class="pb-acc-body">
                <button type="button" class="pb-acc-sub pb-acc-sub-parent ${T?"is-selected":""}"
                        data-acc-toggle="${z(b.parent.name)}">
                  ${ce(T)}
                  <span class="pb-acc-sub-name"><strong>${u(b.parent.name)}</strong> <em class="pb-acc-sub-hint">(parent topic)</em></span>
                </button>
                ${b.subtopics.length?`
                  <ul class="pb-acc-sublist">
                    ${b.subtopics.map($=>{let h=r.has($.name);return`
                        <li>
                          <button type="button" class="pb-acc-sub ${h?"is-selected":""}"
                                  data-acc-toggle="${z($.name)}">
                            ${ce(h)}
                            <span class="pb-acc-sub-name">${u($.name)}</span>
                          </button>
                        </li>
                      `}).join("")}
                  </ul>
                `:""}
              </div>
            </div>
          `}).join("")}
      </div>
    `}function C(m){let b=Pe(m),k=m.trim(),T=r.has(k);return`
      <div class="pb-acc-results">
        <button type="button" class="pb-acc-custom" data-acc-toggle="${z(k)}">
          <span class="pb-acc-custom-plus">${T?"\u2713":"+"}</span>
          <span>${T?"Added":"Add"} "<strong>${u(k)}</strong>" as a custom topic</span>
        </button>
        ${b.map($=>{let h=r.has($.name);return`
            <button type="button" class="pb-acc-result ${h?"is-selected":""}" data-acc-toggle="${z($.name)}">
              ${ce(h)}
              <span class="pb-acc-result-name">${u($.name)}</span>
              ${$.parentName?`<span class="pb-acc-result-parent">in ${u($.parentName)}</span>`:""}
            </button>
          `}).join("")}
        ${b.length===0?'<p class="pb-acc-empty">No matching topics \u2014 try adding it as a custom topic.</p>':""}
      </div>
    `}let j=`
    <div class="pb-acc-search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" class="pb-acc-search-input" placeholder="Search a topic or type your own..." autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    </div>
    <div class="pb-acc-content"></div>`;function f(){let m=v.scrollTop;d.innerHTML=q()+(l.trim()?C(l):x()),v.scrollTop=m,S()}function S(){d.querySelectorAll("[data-acc-toggle]").forEach(m=>{m.addEventListener("click",b=>{b.stopPropagation(),w(m.dataset.accToggle)})}),d.querySelectorAll("[data-acc-expand]").forEach(m=>{m.addEventListener("click",b=>{b.stopPropagation();let k=m.dataset.accExpand;c=c===k?null:k,f()})}),d.querySelectorAll("[data-acc-remove]").forEach(m=>{m.querySelector(".pb-acc-selchip-x")?.addEventListener("click",b=>{b.stopPropagation(),w(m.dataset.accRemove)})})}function H(){if(i)i.classList.add("pb-accordion-body","pb-nested-body"),i.innerHTML=j,v=i;else if(o){let m=Fe({title:e,doneLabel:"Done",onDone:()=>n(Array.from(r)),onCancel:()=>{}});m.classList.add("pb-accordion-body"),m.innerHTML=j,v=m}else P=document.createElement("div"),P.className="pb-modal-overlay pb-accordion-overlay",document.body.appendChild(P),P.innerHTML=`
        <div class="pb-modal-card pb-accordion-card">
          <header class="pb-modal-head">
            <button type="button" class="pb-modal-close" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18"/>
                <line x1="18" y1="6" x2="6" y2="18"/>
              </svg>
            </button>
            <h2 class="pb-modal-title">${u(e)}</h2>
          </header>
          <div class="pb-modal-body pb-accordion-body">${j}</div>
          <footer class="pb-modal-foot">
            <button type="button" class="pb-modal-cancel">Cancel</button>
            <button type="button" class="pb-modal-done">Done</button>
          </footer>
        </div>`,v=P.querySelector(".pb-modal-body"),P.querySelector(".pb-modal-close").addEventListener("click",y),P.querySelector(".pb-modal-done").addEventListener("click",g),P.querySelector(".pb-modal-cancel").addEventListener("click",y),P.addEventListener("click",m=>{m.target===P&&y()});d=v.querySelector(".pb-acc-content"),p=v.querySelector(".pb-acc-search-input"),p.addEventListener("input",m=>{l=m.target.value,f()}),p.addEventListener("keydown",m=>{if(m.key==="Enter"){m.preventDefault();let b=(l||"").trim();if(!b)return;r.has(b)||r.add(b),l="",p.value="",f()}else m.key==="Escape"&&(m.preventDefault(),y())}),f()}i?H():o?_e(H):H()}function Bt(e){return G.fields?.find(n=>n.key===e)?.label||e}function ge(){U&&U.querySelectorAll(".pb-card.is-expanded").forEach(e=>{e.classList.remove("is-expanded"),e.querySelector(".pb-card-config")?.remove()})}function Mt(e,t){let n=pe.find(r=>r.key===t);if(!n)return;ge();let a=ze();e.classList.add("is-expanded");let i=document.createElement("div");i.className="pb-card-config";let o=n.key==="model"?"":`
    <div class="pb-card-config-foot">
      <button type="button" class="pb-cfg-ghost" data-cfg-cancel>Cancel</button>
      <button type="button" class="pb-cfg-cta" data-cfg-done>Done</button>
    </div>`;i.innerHTML=`<div class="pb-card-config-body" data-cfg-body></div>${o}`,e.appendChild(i),i.addEventListener("click",r=>r.stopPropagation()),We(n,i.querySelector("[data-cfg-body]")),i.querySelector("[data-cfg-cancel]")?.addEventListener("click",()=>{le(a),ge(),Ne(),V(),X()}),i.querySelector("[data-cfg-done]")?.addEventListener("click",()=>{ge(),Ne(),V(),X()}),requestAnimationFrame(()=>{try{let r=e.getBoundingClientRect();(r.top<4||r.top>140)&&e.scrollIntoView({block:"start",behavior:"smooth"})}catch{}})}function Je(e,t){e.classList.contains("is-expanded")?ge():Mt(e,t)}function Se(){let t=!J(),n=Object.keys(s.values||{}).length===0&&!s.customizations&&Object.keys(s.customValues||{}).length===0&&Object.keys(s.extraInputs||{}).length===0&&!s.editedPrompt,a=se(),i=D(),o=te(),r=(c,l)=>c.map(d=>`
    <span class="wiz-inline-chip" data-key="${l}" data-value="${z(d)}">
      ${u(d)}
      <button type="button" class="wiz-inline-chip-x" aria-label="Remove">\xD7</button>
    </span>
  `).join("");U.innerHTML=`
    <div class="wiz-two-panel">
      <div class="wiz-fields">
        <div class="wiz-intro">
          <p class="wiz-intro-text">Build knowledge prompts that strategically curate content and deliver clear, high-impact answers. Pick your topics, shape the output, then send straight to your preferred AI model.</p>
        </div>

        <div class="pb-card-grid" id="pb-card-grid">${yt()}</div>
      </div>

      <div class="wiz-action-bar">
        <div class="wiz-action-bar-inner">
          <div class="wiz-action-buttons">
            <button type="button" class="wiz-action-btn is-ready" id="wiz-submit-prompt">
              ${ye.send}<span>Submit Prompt</span>
            </button>
            <button type="button" class="wiz-action-2nd" id="wiz-open-preview">${ye.eye}<span>Preview</span></button>
            <button type="button" class="wiz-action-2nd" id="wiz-export-prompt">${ye.download}<span>Export</span></button>
            <button type="button" class="wiz-action-restart" id="wiz-restart" ${n?"disabled":""}>${ye.clear}<span>Clear</span></button>
          </div>
          <div class="wiz-preview-drawer" id="wiz-preview-drawer" hidden></div>
        </div>
      </div>
      <div class="wiz-action-bar-spacer"></div>
    </div>
  `,U.querySelectorAll(".pb-card").forEach(c=>{c.addEventListener("click",()=>{L?Je(c,c.dataset.pbCard):Ee(c.dataset.pbCard)})}),document.getElementById("wiz-submit-prompt")?.addEventListener("click",async()=>{if(D().length===0){Me();return}let c=_(s.modelId);if(!c){De(!0);return}let l=(s.editedPrompt??J()).trim();l&&(ve("prompt_builder_submit",{model:c.id,edited:s.editedPrompt!=null,length:l.length}),await be(c,l))}),document.getElementById("wiz-open-preview")?.addEventListener("click",()=>{if(D().length===0){Me();return}De()}),document.getElementById("wiz-export-prompt")?.addEventListener("click",()=>{if(D().length===0){Me();return}Ut()}),Ye(),document.getElementById("wiz-restart")?.addEventListener("click",()=>{s.values={},s.customValues={},s.extraInputs={},s.customizations="",s.editedPrompt=null,s.isEditingPrompt=!1,Se()}),V(),!L&&(Ht(),jt())}var we=null,Ae=null;function jt(){let e=()=>{let t=document.querySelector(".wiz-two-panel"),n=document.getElementById("pb-card-grid");if(!t||!n)return;let a=n.getBoundingClientRect().bottom,i=window.innerHeight,r=a+100<=i;document.body.classList.toggle("pb-action-bar-inline",r)};we&&window.removeEventListener("resize",we),Ae=window.innerWidth,we=()=>{window.innerWidth!==Ae&&(Ae=window.innerWidth,requestAnimationFrame(e))},window.addEventListener("resize",we,{passive:!0}),requestAnimationFrame(e),setTimeout(e,250)}var ae=null;function Ht(){ae&&window.removeEventListener("scroll",ae);let e=document.querySelector(".wiz-action-bar"),t=document.getElementById("site-footer");!e||!t||(ae=()=>{let n=t.getBoundingClientRect(),a=window.innerHeight;if(n.top<a){let i=a-n.top;e.style.transform="translateY(-"+i+"px)"}else e.style.transform=""},window.addEventListener("scroll",ae,{passive:!0}),ae())}function ke(e){let t=D(),n=te(),a=(i,o)=>i.map(r=>`
    <span class="wiz-topic-chip" data-key="${o}" data-value="${z(r)}">
      ${u(r)}
      <button type="button" class="wiz-topic-chip-remove" aria-label="Remove">\xD7</button>
    </span>
  `).join("");e.innerHTML=`
    <label class="wiz-label">Primary Topic${t.length>1?"s":""} <span class="wiz-required">*</span></label>
    <div class="wiz-topic-chips" id="wiz-primary-chips">
      ${a(t,"primaryTopic")}
      <button type="button" class="wiz-topic-add" id="wiz-primary-add">
        <span aria-hidden="true">\uFF0B</span> ${t.length===0?"Add primary topic":"Add more"}
      </button>
    </div>

    <label class="wiz-label" style="margin-top: 1.25rem;">Secondary Topic${n.length>1?"s":""} <span class="wiz-optional">(optional)</span></label>
    <div class="wiz-topic-chips" id="wiz-secondary-chips">
      ${a(n,"secondaryTopic")}
      <button type="button" class="wiz-topic-add" id="wiz-secondary-add">
        <span aria-hidden="true">\uFF0B</span> ${n.length===0?"Add secondary topic":"Add more"}
      </button>
    </div>
  `,e.querySelectorAll(".wiz-topic-chip-remove").forEach(i=>{i.addEventListener("click",()=>{let o=i.closest(".wiz-topic-chip");vt(o.dataset.key,o.dataset.value),ke(e),ue(),V()})}),e.querySelector("#wiz-primary-add").addEventListener("click",()=>{rt("Add Primary Topics",t,i=>{s.values.primaryTopic=i,i.length===0&&delete s.values.primaryTopic,ke(e),ue(),V()})}),e.querySelector("#wiz-secondary-add").addEventListener("click",()=>{rt("Add Secondary Topics",n,i=>{s.values.secondaryTopic=i,i.length===0&&delete s.values.secondaryTopic,ke(e),V()})})}var M=null;function rt(e,t,n){M||(M=document.createElement("div"),M.className="wiz-topic-overlay",document.body.appendChild(M));let a=Qe().filter(f=>f.slug!=="home"),i=Ze().map(f=>({parent:f,subtopics:a.filter(S=>S.parent===f.slug)})),o=new Set(Array.isArray(t)?t:[]),r=-1,c=[],l=()=>{M.style.display="none",document.body.style.overflow=""},d=()=>{n(Array.from(o)),l()},v=f=>{let S=(f||"").trim();S&&(o.has(S)?o.delete(S):o.add(S),w(),x())};M.innerHTML=`
    <div class="search-overlay-card wiz-topic-picker-card">
      <div class="wiz-topic-picker-header">
        <h3 class="wiz-topic-picker-title">${u(e)}</h3>
        <button class="search-overlay-close" type="button" id="wiz-topic-overlay-close" aria-label="Close">\u2715</button>
      </div>
      <div class="search-overlay-input-row">
        <svg class="search-bar-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" class="search-overlay-input" id="wiz-topic-overlay-input"
               placeholder="Search or type a custom topic"
               autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" enterkeyhint="done">
      </div>
      <div class="wiz-topic-selected-row" id="wiz-topic-overlay-selected"></div>
      <div class="search-overlay-body shortcuts-sidebar" id="wiz-topic-overlay-body"></div>
      <div class="wiz-topic-picker-foot wiz-topic-picker-foot-left">
        <button type="button" class="wiz-topic-picker-done" id="wiz-topic-overlay-done">Done</button>
      </div>
    </div>
  `;let p=M.querySelector("#wiz-topic-overlay-input"),y=M.querySelector("#wiz-topic-overlay-body"),g=M.querySelector("#wiz-topic-overlay-selected");function w(){o.size===0?g.innerHTML='<span class="wiz-topic-overlay-empty">No topics selected yet.</span>':(g.innerHTML=Array.from(o).map(f=>`
        <span class="wiz-topic-overlay-sel" data-value="${z(f)}">
          ${u(f)}
          <button type="button" class="wiz-topic-overlay-sel-remove" aria-label="Remove">\xD7</button>
        </span>
      `).join(""),g.querySelectorAll(".wiz-topic-overlay-sel-remove").forEach(f=>{f.addEventListener("click",()=>{let S=f.closest(".wiz-topic-overlay-sel");v(S.dataset.value)})}))}function q(){y.querySelectorAll(".wiz-topic-overlay-chip").forEach(f=>{f.classList.toggle("is-selected",o.has(f.dataset.name))})}function x(){let f=p.value,S=f.trim().toLowerCase(),H="";if(S.length>0){let m=Pe(f);c=[{type:"custom",name:f.trim()},...m.map(k=>({type:"topic",name:k.name,parent:k.parentName}))];let b=o.has(f.trim());H+=`
        <div class="search-overlay-custom wiz-topic-result" data-idx="0">
          <span class="search-custom-badge">${b?"\u2713":"+"}</span>
          ${b?"Added":"Add"} "<strong>${u(f.trim())}</strong>"
        </div>
      `,m.length>0&&m.forEach((k,T)=>{let $=o.has(k.name);H+=`
            <div class="sidebar-shortcut wiz-topic-result ${$?"is-selected":""}" data-idx="${T+1}">
              <span class="wiz-topic-check">${$?"\u2713":""}</span>
              <span class="sidebar-shortcut-name">${u(k.name)}</span>
              ${k.parentName?`<span class="wiz-topic-parent-hint">in ${u(k.parentName)}</span>`:""}
            </div>
          `})}else{c=[];let m=Ke();m.length>0&&(H+=`<div class="search-overlay-group">
          <div class="search-featured-header">Featured Topics</div>
          <div class="sidebar-shortcut-list search-subtopic-list">`,m.forEach(b=>{let k=o.has(b.name);H+=`
            <div class="sidebar-shortcut search-subtopic-row wiz-topic-row search-featured-item ${k?"is-selected":""}" data-name="${z(b.name)}">
              <span class="wiz-topic-check">${k?"\u2713":""}</span>
              <span class="sidebar-shortcut-name">${u(b.name)}</span>
            </div>
          `}),H+="</div></div>"),i.forEach(b=>{let k=o.has(b.parent.name);H+=`
          <div class="search-overlay-group">
            <div class="sidebar-shortcut search-parent-row wiz-topic-row ${k?"is-selected":""}" data-name="${z(b.parent.name)}">
              <span class="wiz-topic-check">${k?"\u2713":""}</span>
              <span class="sidebar-shortcut-name">${u(b.parent.name)}</span>
            </div>
            <div class="sidebar-shortcut-list search-subtopic-list">
              ${b.subtopics.map(T=>{let $=o.has(T.name);return`
                  <div class="sidebar-shortcut search-subtopic-row wiz-topic-row ${$?"is-selected":""}" data-name="${z(T.name)}">
                    <span class="wiz-topic-check">${$?"\u2713":""}</span>
                    <span class="sidebar-shortcut-name">${u(T.name)}</span>
                  </div>
                `}).join("")}
            </div>
          </div>
        `})}y.innerHTML=H,y.querySelectorAll(".wiz-topic-row").forEach(m=>{m.addEventListener("click",()=>v(m.dataset.name))}),y.querySelectorAll(".wiz-topic-result").forEach(m=>{m.addEventListener("click",()=>{let b=parseInt(m.dataset.idx,10);c[b]&&(v(c[b].name),b===0&&(p.value=""),x())})})}let C=null;p.addEventListener("input",()=>{r=-1,C&&clearTimeout(C),C=setTimeout(()=>x(),120)}),p.addEventListener("keydown",f=>{f.key==="Enter"?(f.preventDefault(),r>=0&&c[r]?(v(c[r].name),p.value="",x()):c.length>0?(v(c[0].name),p.value="",x()):p.value.trim()&&(v(p.value.trim()),p.value="",x())):f.key==="Escape"?(f.preventDefault(),d()):f.key==="ArrowDown"?(f.preventDefault(),r=Math.min(r+1,c.length-1),updateOverlayHighlight()):f.key==="ArrowUp"&&(f.preventDefault(),r=Math.max(r-1,0),updateOverlayHighlight())}),M.querySelector("#wiz-topic-overlay-close").addEventListener("click",d),M.querySelector("#wiz-topic-overlay-done").addEventListener("click",d),M.style.display="flex",document.body.style.overflow="hidden",w(),x(),y.scrollTop=0,"ontouchstart"in window||navigator.maxTouchPoints>0||p.focus(),M.onclick=f=>{f.target===M&&d()}}function Rt(e){e.classList.add("wiz-step-body","wiz-grid-2"),e.innerHTML=`
    <div class="wiz-sub-section wiz-sub-section-wide">
      <label class="wiz-sub-label">Content Type</label>
      <div class="wiz-cards-wrap"></div>
      <div class="wiz-extras" data-extras-field="contentType"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Approach <span class="wiz-optional">(optional)</span></label>
      <div data-field="contentGeneration"></div>
      <div class="wiz-extras" data-extras-field="contentGeneration"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Source Types <span class="wiz-optional">(pick one or more)</span></label>
      <div data-field="sources"></div>
      <div class="wiz-extras" data-extras-field="sources"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Time Period</label>
      <div data-field="recency"></div>
      <div class="wiz-extras" data-extras-field="recency"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Citations</label>
      <div data-field="citations"></div>
    </div>
  `,Ot(e.querySelector(".wiz-cards-wrap"),"contentType"),O(e.querySelector('[data-field="contentGeneration"]'),"contentGeneration"),O(e.querySelector('[data-field="sources"]'),"sources"),O(e.querySelector('[data-field="recency"]'),"recency"),O(e.querySelector('[data-field="citations"]'),"citations"),K(e.querySelector('[data-extras-field="contentType"]'),"contentType"),K(e.querySelector('[data-extras-field="contentGeneration"]'),"contentGeneration"),K(e.querySelector('[data-extras-field="sources"]'),"sources"),K(e.querySelector('[data-extras-field="recency"]'),"recency")}function Nt(e){e.classList.add("wiz-step-body","wiz-grid-2"),e.innerHTML=`
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Output Format</label>
      <div data-field="format"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Length</label>
      <div data-field="length"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Reading Level</label>
      <div data-field="audience"></div>
    </div>
    <div class="wiz-sub-section">
      <label class="wiz-sub-label">Writing Tone</label>
      <div data-field="tone"></div>
    </div>
    <div class="wiz-sub-section wiz-sub-section-wide">
      <label class="wiz-sub-label">Geographic Focus <span class="wiz-optional">(pick one or more)</span></label>
      <div data-field="geographic"></div>
    </div>
    <div class="wiz-sub-section wiz-sub-section-wide">
      <label class="wiz-sub-label">Custom Instructions <span class="wiz-optional">(optional)</span></label>
      <textarea class="wiz-textarea" id="wiz-custom"
                placeholder="Add any extra instructions, e.g. 'Include code examples' or 'Avoid jargon'">${u(s.customizations||"")}</textarea>
    </div>
  `,O(e.querySelector('[data-field="format"]'),"format"),O(e.querySelector('[data-field="length"]'),"length"),O(e.querySelector('[data-field="audience"]'),"audience"),O(e.querySelector('[data-field="tone"]'),"tone"),O(e.querySelector('[data-field="geographic"]'),"geographic");let t=e.querySelector("#wiz-custom");t.addEventListener("input",()=>{s.customizations=t.value,$e()})}function Oe(e){let t=s.editedPrompt??J(),n=it(_(s.modelId)||He[0],t),a=s.isEditingPrompt===!0;if(e.innerHTML=`
    <div class="wiz-review">
      <div class="wiz-review-section">
        <div class="wiz-review-head">
          <label class="wiz-sub-label">Your Prompt</label>
          <div class="wiz-review-actions">
            <button class="wiz-btn-inline" id="wiz-copy-btn" type="button">\u{1F4CB} Copy</button>
            <button class="wiz-btn-inline" id="wiz-edit-btn" type="button">${a?"\u2713 Done":"\u270E Edit"}</button>
          </div>
        </div>
        ${a?`<textarea class="wiz-prompt-edit" id="wiz-prompt-edit">${u(t)}</textarea>`:`<div class="wiz-prompt-box">${u(t)}</div>`}
        ${s.editedPrompt!=null&&!a?'<button class="wiz-prompt-reset" id="wiz-prompt-reset" type="button">Reset to generated prompt</button>':""}
      </div>
      <div class="wiz-review-section">
        <label class="wiz-sub-label">Choose AI Model</label>
        <div class="wiz-model-grid" id="wiz-model-grid">
          ${He.map(i=>`
            <button class="wiz-model-btn ${i.id===s.modelId?"selected":""}" type="button" data-model-id="${i.id}">
              ${u(i.name)}
            </button>
          `).join("")}
        </div>
      </div>
      ${n?'<div class="wiz-warning">Prompt may be too long for direct URL submission. Use Copy + Open Model instead.</div>':""}
      <button class="wiz-btn-submit" id="wiz-submit" type="button">${u(Ve())}</button>
      <button class="wiz-btn-restart" id="wiz-restart" type="button">Start Over</button>
      <p class="wiz-disclaimer">Standard Topic is not responsible for actions taken once you leave this site. You will be redirected to a third-party AI platform.</p>
    </div>
  `,e.querySelector("#wiz-copy-btn").addEventListener("click",async()=>{let i=s.isEditingPrompt?e.querySelector("#wiz-prompt-edit").value:t;await navigator.clipboard.writeText(i);let o=e.querySelector("#wiz-copy-btn"),r=o.textContent;o.textContent="\u2713 Copied!",setTimeout(()=>{o.textContent=r},2e3)}),e.querySelector("#wiz-edit-btn").addEventListener("click",()=>{if(s.isEditingPrompt){let i=e.querySelector("#wiz-prompt-edit");s.editedPrompt=i.value,s.isEditingPrompt=!1}else s.isEditingPrompt=!0;Oe(e)}),e.querySelector("#wiz-prompt-reset")?.addEventListener("click",()=>{s.editedPrompt=null,Oe(e)}),a){let i=e.querySelector("#wiz-prompt-edit");i.focus(),i.setSelectionRange(i.value.length,i.value.length)}e.querySelector("#wiz-model-grid").addEventListener("click",i=>{let o=i.target.closest("[data-model-id]");if(!o)return;s.modelId=o.dataset.modelId,me(s.modelId),e.querySelectorAll(".wiz-model-btn").forEach(c=>{c.classList.toggle("selected",c.dataset.modelId===s.modelId)});let r=e.querySelector("#wiz-submit");r&&(r.textContent=Ve())}),e.querySelector("#wiz-submit").addEventListener("click",async()=>{let i=_(s.modelId);if(!i)return;let o=s.isEditingPrompt?e.querySelector("#wiz-prompt-edit").value:t;await be(i,o)}),e.querySelector("#wiz-restart").addEventListener("click",()=>{s.step=0,s.values={},s.customValues={},s.extraInputs={},s.customizations="",s.editedPrompt=null,s.isEditingPrompt=!1,Se(),window.scrollTo(0,0)})}function Ot(e,t){let n=Y(t),a=s.customValues[t]||{},i=pt(t),o='<div class="wiz-cards">';n.forEach(r=>{let c=ee(t,r.value);o+=`
      <button class="wiz-card ${c?"selected":""}" type="button" data-value="${z(r.value)}">
        <div class="wiz-card-icon">${zt[r.value]||xt}</div>
        <div class="wiz-card-label">${u(r.label)}</div>
        ${c?`<span class="wiz-card-remove" data-remove="${z(r.value)}" aria-label="Remove">\xD7</span>`:""}
      </button>
    `}),Object.entries(a).forEach(([r,c])=>{ee(t,r)&&(o+=`
      <div class="wiz-card selected wiz-card-custom" data-value="${z(r)}">
        <div class="wiz-card-icon">${$t}</div>
        <div class="wiz-card-label">${u(c)}</div>
        <button class="wiz-card-remove" type="button" data-remove="${z(r)}" aria-label="Remove">\xD7</button>
      </div>
    `)}),i&&(o+=`
      <button class="wiz-card wiz-card-add" type="button" data-add-custom="true">
        <div class="wiz-card-icon">${Et}</div>
        <div class="wiz-card-label">Add custom</div>
      </button>
    `),o+="</div>",e.innerHTML=o,Dt(e,t,".wiz-card",".wiz-card-add",".wiz-card-remove")}function O(e,t){let n=Y(t),a=s.customValues[t]||{},i=pt(t),o=W(t),r=o.map(p=>{let y=n.find(g=>g.value===p);return y?y.label:a[p]?a[p]:p}),c=r.map((p,y)=>`
    <span class="wiz-inline-chip" data-key="${z(t)}" data-value="${z(o[y])}">
      ${u(p)}
      <button type="button" class="wiz-inline-chip-x" aria-label="Remove">\xD7</button>
    </span>
  `).join("");e.innerHTML=`
    <div class="wiz-topic-chips" id="wiz-field-chips-${t}">
      ${c}
      <button type="button" class="wiz-topic-add-inline" id="wiz-field-add-${t}">${r.length?"+ Add more":"+ Select"}</button>
    </div>
  `,e.querySelectorAll(".wiz-inline-chip-x").forEach(p=>{p.addEventListener("click",y=>{y.stopPropagation();let g=p.closest(".wiz-inline-chip");bt(g.dataset.key,g.dataset.value),O(e,t),V(),X()})});let l=()=>{O(e,t),V(),X()},d=!!(L&&U&&U.querySelector(".pb-card.is-expanded")),v=()=>{if(d){let p=e.closest(".pb-modal-section")||e,y=p.querySelector(".pb-nested-picker");if(p.parentElement?.querySelectorAll(".pb-nested-picker").forEach(w=>w.remove()),y)return;let g=document.createElement("div");g.className="pb-nested-picker",p.appendChild(g),ct(t,n,a,i,l,{container:g,onClose:()=>{g.remove(),l()}}),requestAnimationFrame(()=>ft(p))}else ct(t,n,a,i,l)};e.querySelector(`#wiz-field-add-${t}`)?.addEventListener("click",v),e.querySelector(`#wiz-field-chips-${t}`)?.addEventListener("click",p=>{!p.target.closest(".wiz-inline-chip-x")&&!p.target.closest(".wiz-topic-add-inline")&&v()})}var A=null;function ct(e,t,n,a,i,o){let r=o&&o.container,c=!r&&!!L;!c&&!r&&A&&(A.remove(),A=null);let l=Ce(e),d=l?.label||e,v=l?.description||"",p="",y,g,w,q=ze(),x=()=>{if(r){i(),o.onClose&&o.onClose();return}if(c){i(),de();return}A?.remove(),A=null,i()},C=()=>{le(q),x()},j=h=>{Re(e,h),k()},f=h=>{let E=h.trim().toLowerCase();if(!E)return null;let I=t.find(R=>R.label.toLowerCase()===E||R.value.toLowerCase()===E);if(I)return{type:"opt",value:I.value};let Q=s.customValues[e]||{};for(let[R,B]of Object.entries(Q))if(B.toLowerCase()===E)return{type:"custom",value:R};return null},S=()=>{let h=(p||"").trim();if(!h)return;let E=f(h);if(E)ee(e,E.value)||Re(e,E.value);else if(a)mt(e,h);else return;p="",w&&(w.value=""),k()};function H(){let h=W(e);if(h.length===0)return"";let E=s.customValues[e]||{};return`
      <div class="pb-acc-selected">
        ${h.map(I=>{let Q=t.find(B=>B.value===I),R=Q?Q.label:E[I]||I;return`
            <span class="pb-acc-selchip" data-acc-remove="${z(I)}">
              ${u(R)}
              <button type="button" class="pb-acc-selchip-x" aria-label="Remove">\xD7</button>
            </span>
          `}).join("")}
      </div>
    `}function m(){let h=(p||"").trim().toLowerCase(),E=s.customValues[e]||{},I=h?t.filter(B=>B.label.toLowerCase().includes(h)):t.slice(),Q=Object.entries(E).filter(([B,ne])=>!h||ne.toLowerCase().includes(h)),R='<div class="pb-acc-results">';return h&&a&&(f(p)||(R+=`
          <button type="button" class="pb-acc-custom" data-acc-add-custom="1">
            <span class="pb-acc-custom-plus">+</span>
            <span>Add "<strong>${u(p.trim())}</strong>" as a custom value</span>
          </button>
        `)),I.forEach(B=>{let ne=ee(e,B.value);R+=`
        <button type="button" class="pb-acc-result ${ne?"is-selected":""}" data-acc-toggle="${z(B.value)}">
          ${ce(ne)}
          <span class="pb-acc-result-name">${u(B.label)}</span>
        </button>
      `}),Q.forEach(([B,ne])=>{let Xe=ee(e,B);R+=`
        <button type="button" class="pb-acc-result ${Xe?"is-selected":""}" data-acc-toggle="${z(B)}">
          ${ce(Xe)}
          <span class="pb-acc-result-name">${u(ne)}</span>
          <span class="pb-acc-result-parent">custom</span>
        </button>
      `}),I.length===0&&Q.length===0&&!(h&&a)&&(R+='<p class="pb-acc-empty">No matches.</p>'),R+="</div>",R}let b=`
    <div class="pb-acc-search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" class="pb-acc-search-input" placeholder="${a?"Search or type to add custom\u2026":"Search options\u2026"}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    </div>
    <div class="pb-acc-content"></div>`;function k(){let h=g.scrollTop;y.innerHTML=H()+m(),g.scrollTop=h,T()}function T(){y.querySelectorAll("[data-acc-toggle]").forEach(E=>{E.addEventListener("click",I=>{I.stopPropagation(),j(E.dataset.accToggle)})}),y.querySelectorAll("[data-acc-remove]").forEach(E=>{E.querySelector(".pb-acc-selchip-x")?.addEventListener("click",I=>{I.stopPropagation(),j(E.dataset.accRemove)})});let h=y.querySelector("[data-acc-add-custom]");h&&h.addEventListener("click",S)}function $(){if(r)r.classList.add("pb-accordion-body","pb-nested-body"),r.innerHTML=b,g=r;else if(c){let h=Fe({title:d,doneLabel:"Done",onDone:()=>{i()},onCancel:()=>{le(q),i()}});h.classList.add("pb-accordion-body"),h.innerHTML=b,g=h}else A=document.createElement("div"),A.className="pb-modal-overlay pb-accordion-overlay",document.body.appendChild(A),A.innerHTML=`
        <div class="pb-modal-card pb-accordion-card">
          <header class="pb-modal-head">
            <button type="button" class="pb-modal-close" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18"/>
                <line x1="18" y1="6" x2="6" y2="18"/>
              </svg>
            </button>
            <div class="pb-modal-title-block">
              <h2 class="pb-modal-title">${u(d)}</h2>
              ${v?`<p class="pb-modal-subtitle">${u(v)}</p>`:""}
            </div>
          </header>
          <div class="pb-modal-body pb-accordion-body">${b}</div>
          <footer class="pb-modal-foot">
            <button type="button" class="pb-modal-cancel">Cancel</button>
            <button type="button" class="pb-modal-done">Done</button>
          </footer>
        </div>`,g=A.querySelector(".pb-modal-body"),A.querySelector(".pb-modal-close").addEventListener("click",C),A.querySelector(".pb-modal-done").addEventListener("click",x),A.querySelector(".pb-modal-cancel").addEventListener("click",C),A.addEventListener("click",h=>{h.target===A&&C()});y=g.querySelector(".pb-acc-content"),w=g.querySelector(".pb-acc-search-input"),w.addEventListener("input",()=>{p=w.value,k()}),w.addEventListener("keydown",h=>{h.key==="Enter"?(h.preventDefault(),S()):h.key==="Escape"&&(h.preventDefault(),x())}),k()}r?$():c?_e($):$()}function Dt(e,t,n,a,i){if(e.dataset.handlersAttached==="true")return;e.dataset.handlersAttached="true";let o=Y(t);e.addEventListener("click",r=>{let c=r.target.closest(i);if(c&&e.contains(c)){r.stopPropagation(),r.preventDefault(),bt(t,c.dataset.remove),Le(t);return}let l=r.target.closest(a);if(l&&e.contains(l)){r.preventDefault(),Vt(l,t);return}let d=r.target.closest(n);if(!d||!e.contains(d)||d.matches(a))return;let v=d.dataset.value;if(!v)return;let p=ee(t,v);if(Re(t,v),!!s.customValues[t]?.[v]&&!ee(t,v)){delete s.customValues[t][v],Le(t);return}if(o.find(w=>w.value===v)?.requiresInput){d.classList.toggle("selected",!p),st(d,v,!p);let w=document.querySelector(`[data-extras-field="${t}"]`);w&&K(w,t),$e(),ue();return}d.classList.toggle("selected",!p),st(d,v,!p),$e(),ue()})}function Vt(e,t){let n=document.createElement("div");n.className="wiz-custom-input-wrap",n.innerHTML=`
    <input type="text" class="wiz-custom-input" placeholder="Type and press Enter\u2026" autofocus>
    <button class="wiz-custom-add-btn" type="button">Add</button>
    <button class="wiz-custom-cancel-btn" type="button" aria-label="Cancel">\u2715</button>
  `,e.parentNode.replaceChild(n,e);let a=n.querySelector(".wiz-custom-input"),i=n.querySelector(".wiz-custom-add-btn"),o=n.querySelector(".wiz-custom-cancel-btn");a.focus();let r=()=>{let l=a.value.trim();l&&mt(t,l),Le(t)},c=()=>{Le(t)};i.addEventListener("click",r),o.addEventListener("click",c),a.addEventListener("keydown",l=>{l.key==="Enter"&&(l.preventDefault(),r()),l.key==="Escape"&&(l.preventDefault(),c())})}function Le(e){let t=document.querySelector(`[data-field="${e}"]`);t&&O(t,e);let n=document.querySelector(`[data-extras-field="${e}"]`);n&&K(n,e),V(),ue(),X()}function K(e,t){if(!e)return;let n=W(t),a=Y(t),i=[];if(n.forEach(o=>{let r=a.find(c=>c.value===o);r?.requiresInput&&i.push({option:r,req:r.requiresInput})}),i.length===0){e.innerHTML="";return}e.innerHTML=i.map(({option:o,req:r})=>`
    <div class="wiz-extra-input">
      <label class="wiz-extra-label">
        ${u(r.label)}
        <span class="wiz-extra-context">\u2014 for "${u(o.label)}"</span>
        ${r.optional?'<span class="wiz-optional">(optional)</span>':""}
      </label>
      <input type="text" class="wiz-input wiz-extra-field"
             data-extra-key="${z(r.key)}"
             placeholder="${z(r.placeholder||"")}"
             value="${z(s.extraInputs[r.key]||"")}">
    </div>
  `).join(""),e.querySelectorAll(".wiz-extra-field").forEach(o=>{o.addEventListener("input",()=>{s.extraInputs[o.dataset.extraKey]=o.value,$e()})})}function ue(){let e=ut[s.step],t=document.getElementById("wiz-next");t&&(e.required&&!e.isComplete?.()?t.setAttribute("disabled",""):t.removeAttribute("disabled"))}var Ie=null,N=null,F=null,oe=null,lt=!1,Be=12,_t=720;function Me(){document.querySelector(".pb-required-overlay")?.remove();let e=document.createElement("div");e.className="pb-required-overlay",e.innerHTML=`
    <div class="pb-required-card" role="dialog" aria-modal="true" aria-label="Primary topic required">
      <span class="pb-required-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg></span>
      <h3 class="pb-required-title">Add a primary topic first</h3>
      <p class="pb-required-body">A prompt needs at least one <strong>primary topic</strong> before you can submit it \u2014 that's what the AI focuses on.</p>
      <div class="pb-required-foot">
        <button type="button" class="pb-required-go">Choose a primary topic</button>
        <button type="button" class="pb-required-dismiss">Not now</button>
      </div>
    </div>`,document.body.appendChild(e);let t=()=>e.remove();e.addEventListener("click",n=>{n.target===e&&t()}),e.querySelector(".pb-required-dismiss").addEventListener("click",t),e.querySelector(".pb-required-go").addEventListener("click",()=>{t(),Ft()})}function Ft(){let e=U||document,t=e.querySelector('.pb-card[data-pb-card="topics"]');if(!t){L||Ee("topics");return}if(!t.classList.contains("is-expanded"))if(L)Je(t,"topics");else{Ee("topics");return}try{t.scrollIntoView({block:"start",behavior:"smooth"})}catch{}setTimeout(()=>{let n=e.querySelector("#pb-topicbar-primaryTopic");(n?.querySelector(".wiz-topic-add-inline")||n)?.click()},90)}function De(e){let t=document.getElementById("wiz-preview-drawer"),n=document.getElementById("wiz-open-preview");if(!t)return;if(e??t.hidden){t.hidden=!1,n&&n.classList.add("is-open"),F=t,Z();try{t.scrollIntoView({block:"nearest"})}catch{}}else t.hidden=!0,n&&n.classList.remove("is-open"),F=null,t.innerHTML="";Ye()}function Ye(){let e=document.getElementById("wiz-submit-disc");if(!e)return;let t=_(s.modelId),a=(t?qe?.()??{}:{})[t&&t.submissionMethod||"direct"]||{},i=t&&a.description?`Model info: ${t.name} \u2014 ${a.description.replace(/\{model\}/g,t.name)} `:"";e.textContent=`${i}Disclaimer: You'll be redirected to a third-party AI platform. Standard Topic isn't responsible for actions taken once you leave this site.`}function Gt(){let e=_(s.modelId),t=D(),n=t.length?t.join(", "):"Custom Knowledge Prompt",a=[];a.push(`# ${n} \u2014 Knowledge Prompt`,""),a.push("_Built with the Standard Topic Prompt Builder._",""),e&&a.push(`**Model:** ${e.name}`,"");let i=[];for(let r of pe){if(r.key==="model")continue;let c=Ue(r);if(c.length){i.push(`### ${r.label}`,"");for(let l of c)l.custom?i.push(`**${l.label}:**`,"",l.custom,""):l.values.length===1?i.push(`- **${l.label}:** ${l.values[0]}`):(i.push(`- **${l.label}:**`),l.values.forEach(d=>i.push(`  - ${d}`)));i.push("")}}i.length&&(a.push("## Configuration",""),a.push(...i));let o=(s.editedPrompt??J()).trim();return a.push("## Prompt","","```text",o||"(empty)","```",""),a.join(`
`)}function Ut(){let e=Gt(),t=D(),n=(t[0]||"custom-prompt").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)||"custom-prompt",a=new Date,i=`${a.getFullYear()}${String(a.getMonth()+1).padStart(2,"0")}${String(a.getDate()).padStart(2,"0")}`,o=`standard-topic-prompt-${n}-${i}.md`;try{let l=new Blob([e],{type:"text/markdown;charset=utf-8"}),d=URL.createObjectURL(l),v=document.createElement("a");v.href=d,v.download=o,document.body.appendChild(v),v.click(),v.remove(),setTimeout(()=>URL.revokeObjectURL(d),1500)}catch{return}try{ve("prompt_builder_export",{model:s.modelId||"",topics:t.length,length:e.length})}catch{}let r=document.getElementById("wiz-export-prompt"),c=r&&r.querySelector("span");if(r&&c&&!r.dataset.flashing){r.dataset.flashing="1";let l=c.textContent;c.textContent="Exported \u2713",r.classList.add("is-done"),setTimeout(()=>{c.textContent=l,r.classList.remove("is-done"),delete r.dataset.flashing},1600)}}function Wt(){if(!Ie)return;Ie.classList.remove("is-open"),N.classList.remove("is-open"),N.classList.add("is-closing");let e=()=>{N.removeEventListener("transitionend",e),Ie.style.display="none",N.style.display="none",N.classList.remove("is-closing"),N.style.cssText="",document.body.style.overflow=""};N.addEventListener("transitionend",e),setTimeout(e,280),lt&&(lt=!1,window.removeEventListener("resize",dt),window.removeEventListener("scroll",dt),oe&&cancelAnimationFrame(oe),oe=null)}function dt(){oe||(oe=requestAnimationFrame(()=>{oe=null,Jt()}))}function Jt(){let e=window.innerWidth,t=window.innerHeight,n=Math.min(_t,e-Be*2),a=Math.round((e-n)/2),i=Math.max(Be,Math.round(t*.06)),o=t-i-Be;N.style.left=`${a}px`,N.style.top=`${i}px`,N.style.width=`${n}px`,N.style.maxHeight=`${o}px`}function Z(){let e=F||N,t=(s.editedPrompt??J()).trim(),n=se(),a=!t,i=s.editedPrompt!=null&&!s.isEditingPrompt,o=_(s.modelId),r=o?qe?.()??{}:{},c=o?.submissionMethod||"direct",l=r[c]||{},d=n.map(v=>`
    <button class="pm-model" type="button" data-model-id="${v.id}" aria-pressed="${v.id===s.modelId?"true":"false"}">
      <span class="pm-model-name">${u(v.name)}</span>
    </button>
  `).join("");e.innerHTML=`
    <div class="pm-header">
      <div class="pm-title">
        <span class="pm-title-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l1.9 5.4a2 2 0 0 0 1.25 1.25L20.55 11.5l-5.4 1.85a2 2 0 0 0-1.25 1.25L12 20l-1.9-5.4a2 2 0 0 0-1.25-1.25L3.45 11.5l5.4-1.85a2 2 0 0 0 1.25-1.25z"/>
            <path d="M19 3l.6 1.6L21.2 5.2 19.6 5.8 19 7.4 18.4 5.8 16.8 5.2 18.4 4.6z"/>
          </svg>
        </span>
        <h3 class="pm-title-name">Preview Prompt</h3>
      </div>
      <button type="button" class="pm-close" id="wiz-submit-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
      </button>
    </div>

    <div class="pm-body">
      <section class="pm-section">
        ${i?'<div class="pm-section-head"><button type="button" class="pm-reset" id="wiz-submit-reset">Reset to generated</button></div>':""}
        <div class="pm-preview-wrap ${s.isEditingPrompt?"is-editing":""}">
          ${s.isEditingPrompt?`<textarea class="pm-textarea" id="wiz-submit-textarea">${u(t)}</textarea>`:`<div class="pm-preview ${a?"is-empty":""}" id="wiz-submit-preview" tabindex="0" role="button" aria-label="Click to edit prompt">${a?"Add a topic to start building your prompt\u2026":u(t)}</div>`}
          <div class="pm-preview-actions">
            <button type="button" class="pm-copy-btn" id="wiz-submit-copy" aria-label="Copy prompt">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="8" height="9" rx="1.2"/><path d="M9.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1"/></svg>
              <span class="pm-copy-btn-label">Copy</span>
            </button>
            <button type="button" class="pm-icon-btn" id="wiz-submit-edit" aria-label="${s.isEditingPrompt?"Save":"Edit"} prompt" title="${s.isEditingPrompt?"Save":"Edit"}">
              ${s.isEditingPrompt?'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5,7.5 5.5,10.5 11.5,4"/></svg>':'<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.2l2.3 2.3-7 7H2.5v-2.3l7-7z"/></svg>'}
            </button>
          </div>
        </div>
      </section>

      <section class="pm-section">
        <div class="pm-section-label">Choose AI Model</div>
        <div class="pm-models" id="wiz-submit-models">${d}</div>
      </section>

      <section class="pm-submit-area">
        <div class="pm-actions">
          <button class="pm-submit pm-submit--sm" id="wiz-submit-go" type="button" ${a?"disabled":""}>${u(Ve())}</button>
        </div>
        ${o?`
          <div class="pm-meta">
            ${l.description?`<div class="pm-meta-block"><span class="pm-meta-h">Model info</span><p class="pm-meta-t">${u(o.name)} \u2014 ${u(l.description.replace(/\{model\}/g,o.name))}</p></div>`:""}
            <div class="pm-meta-block"><span class="pm-meta-h">Disclaimer</span><p class="pm-meta-t">You'll be redirected to a third-party AI platform. Standard Topic isn't responsible for actions taken once you leave this site.</p></div>
          </div>
        `:""}
      </section>
    </div>
  `,Yt()}function Yt(){let e=F||N,n=F&&F.id==="wiz-preview-drawer"?()=>De(!1):F?()=>{F=null,de()}:Wt;e.querySelector("#wiz-submit-close").addEventListener("click",n),e.querySelector("#wiz-submit-copy").addEventListener("click",async i=>{i.stopPropagation();let o=s.isEditingPrompt?e.querySelector("#wiz-submit-textarea")?.value??"":(s.editedPrompt??J()).trim(),r=!1;try{navigator.clipboard&&window.isSecureContext&&(await navigator.clipboard.writeText(o),r=!0)}catch{}if(!r)try{let d=document.createElement("textarea");d.value=o,d.style.position="fixed",d.style.top="0",d.style.left="0",d.style.opacity="0",d.setAttribute("readonly",""),document.body.appendChild(d),d.select(),d.setSelectionRange(0,d.value.length),r=document.execCommand("copy"),document.body.removeChild(d)}catch{}let c=i.currentTarget;c.classList.add("is-copied");let l=c.querySelector(".pm-copy-btn-label");if(l){let d=l.textContent;l.textContent=r?"Copied":"Copy failed",setTimeout(()=>{l.textContent=d},1400)}setTimeout(()=>c.classList.remove("is-copied"),1400)}),e.querySelector("#wiz-submit-edit").addEventListener("click",i=>{if(i.stopPropagation(),s.isEditingPrompt){let o=e.querySelector("#wiz-submit-textarea");o&&(s.editedPrompt=o.value),s.isEditingPrompt=!1}else s.isEditingPrompt=!0;Z()});let a=e.querySelector("#wiz-submit-preview");a&&(a.addEventListener("click",()=>{s.isEditingPrompt||(s.isEditingPrompt=!0,Z())}),a.addEventListener("keydown",i=>{(i.key==="Enter"||i.key===" ")&&(i.preventDefault(),s.isEditingPrompt=!0,Z())})),e.querySelector("#wiz-submit-reset")?.addEventListener("click",()=>{s.editedPrompt=null,Z()}),e.querySelector("#wiz-submit-models").addEventListener("click",i=>{let o=i.target.closest("[data-model-id]");o&&(s.modelId=o.dataset.modelId,me(s.modelId),Z())}),e.querySelector("#wiz-submit-go")?.addEventListener("click",async()=>{let i=_(s.modelId);if(!i)return;let o=s.isEditingPrompt?e.querySelector("#wiz-submit-textarea")?.value:s.editedPrompt??J();ve("prompt_builder_submit",{model:i.id,edited:s.editedPrompt!=null,length:o.trim().length}),await be(i,o.trim()),n()})}function V(){if(s.isEditingPrompt)return;let e=document.getElementById("wiz-preview-body");if(!e)return;let t=(s.editedPrompt??J()).trim();e.textContent=t||"Add a topic to start building your prompt...",e.classList.toggle("is-empty",!t);let n=document.getElementById("wiz-submit");n&&(n.disabled=!t);let a=document.querySelector(".wiz-mobile-preview-indicator");a&&a.classList.toggle("has-content",!!t)}function Ve(){let e=_(s.modelId);return e?`Send Prompt with ${e.name}`:"Send Prompt"}function J(){let e=D(),t=te();if(e.length===0)return"";let n=je(e),a=t.length?je(t):"",i=w=>{let q=w.replace(/\{primary_topic\}/g,n).replace(/\{secondary_topic\}/g,a||n);return Object.entries(s.extraInputs).forEach(([x,C])=>{let j=C?.trim()||`[${x.replace(/_/g," ")}]`;q=q.replace(new RegExp(`\\{${x}\\}`,"g"),j)}),q},o=w=>{let q=W(w);if(q.length===0)return[];let x=Y(w);return q.map(C=>{let j=x.find(S=>S.value===C);if(j)return j.clause?i(j.clause):null;let f=xe(w,C);return f?Qt(w,f):null}).filter(Boolean)},r=Xt(n,i),c=[],l=[...o("sources"),...o("recency"),...o("citations")];l.length>0&&c.push(l.map(re).join(" "));let d=[...o("format"),...o("length")];d.length>0&&c.push(d.map(re).join(" "));let v=[...o("audience"),...o("tone")];v.length>0&&c.push(v.map(re).join(" "));let p=W("geographic");if(p.length===1){let w=o("geographic")[0];w&&c.push(re(w))}else if(p.length>1){let w=p.map(q=>{let x=Y("geographic").find(C=>C.value===q);return x?x.label:xe("geographic",q)}).filter(Boolean);c.push(`Cover the following geographic perspectives: ${je(w)}.`)}a&&G.secondaryTopicClause&&c.push(i(G.secondaryTopicClause));let y=(s.customizations||"").trim();y&&c.push(`Additional instructions: ${y}`);let g=[r];return g.push(...c),c.length>0&&g.push(G.closingLine),g.join(`

`)}function Xt(e,t){let n=W("outputType");if(n.length===0)return t(G.baseTemplate);if(n.length===1){let i=n[0],o=Y("outputType").find(c=>c.value===i);if(o?.clause)return re(t(o.clause));let r=xe("outputType",i);return r?`Provide ${r} about ${e}.`:t(G.baseTemplate)}let a=n.map(i=>{let o=Y("outputType").find(r=>r.value===i);if(o){let r=o.label;if(o.requiresInput){let c=s.extraInputs[o.requiresInput.key]?.trim();c&&(r+=` with ${c}`)}return r}return xe("outputType",i)}).filter(Boolean);return`Provide the following about ${e}:
`+a.map(i=>`\u2022 ${i}`).join(`
`)}function je(e){return e.length===0?"":e.length===1?e[0]:e.length===2?`${e[0]} and ${e[1]}`:`${e.slice(0,-1).join(", ")}, and ${e[e.length-1]}`}function re(e){return e&&(/[.!?]$/.test(e.trim())?e:e+".")}function Qt(e,t){switch(e){case"outputType":return`Provide ${t} on the topic`;case"sources":return`Draw from ${t}`;case"recency":return`Focus on information from ${t}`;case"citations":return`Use ${t} citation style`;case"format":return`Format the response as ${t}`;case"length":return`Target a ${t} length response`;case"audience":return`Write for a ${t} audience`;case"tone":return`Use a ${t} tone`;case"geographic":return`Focus on ${t}`;default:return t}}function u(e){if(e==null)return"";let t=document.createElement("div");return t.textContent=String(e),t.innerHTML}function z(e){return String(e||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}export{on as getAssembledPrompt,sn as renderPromptGenerator};
