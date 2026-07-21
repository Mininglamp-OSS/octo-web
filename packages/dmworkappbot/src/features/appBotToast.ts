export function showErrorToast(message: string) {
  const el = document.createElement("div")
  el.className = "appbot-toast appbot-toast-error"
  el.textContent = message
  document.body.appendChild(el)
  requestAnimationFrame(() => {
    el.classList.add("appbot-toast-visible")
  })
  setTimeout(() => {
    el.classList.remove("appbot-toast-visible")
    setTimeout(() => el.remove(), 200)
  }, 3000)
}
