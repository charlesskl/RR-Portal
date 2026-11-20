const sections = [...document.querySelectorAll("section")];
const links = [...document.querySelectorAll("nav a")];

function showMonth() {
  const month = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit"
  }).format(new Date());
  const active = sections.find(s => "#" + s.id === location.hash)
    || sections.find(s => s.id === "m" + month)
    || sections[sections.length - 1];
  for (const section of sections) section.hidden = section !== active;
  for (const link of links) {
    if (link.hash === "#" + active.id) link.setAttribute("aria-current", "date");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener("hashchange", showMonth);
showMonth();
