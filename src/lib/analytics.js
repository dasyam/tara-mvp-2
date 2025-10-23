export function initAnalytics() {
  const GA = import.meta.env.VITE_GA4_ID;
  const CL = import.meta.env.VITE_CLARITY_ID;

  // GA4
  if (GA) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){ dataLayer.push(arguments); };
    gtag('js', new Date()); gtag('config', GA);
    const s = document.createElement("script");
    s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${GA}`;
    document.head.appendChild(s);
  }

  // Clarity
  if (CL) {
    (function(c,l,a,r,i,t,y){ c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", CL);
  }
}

export function emitEvent(name, payload={}) {
  if (window.gtag) window.gtag('event', name, payload);
  if (window.clarity) window.clarity('set', name, payload);
}
