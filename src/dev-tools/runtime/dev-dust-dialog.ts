/** Native HTML dialog: Electron does not implement window.prompt(). Dev-only caller. */
export function requestDevDustAmount(current: number): Promise<number | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-label', 'Set Arcane Dust')
    dialog.style.cssText =
      'color:#eee;background:#222;border:1px solid #777;border-radius:8px;padding:24px;font:16px sans-serif;min-width:300px'
    const form = document.createElement('form')
    const label = document.createElement('label')
    label.textContent = 'Set current Arcane Dust'
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '0'
    input.max = String(Number.MAX_SAFE_INTEGER)
    input.step = '1'
    input.required = true
    input.value = String(current)
    input.style.cssText = 'display:block;margin:16px 0;padding:8px;width:260px'
    label.appendChild(input)
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    const save = document.createElement('button')
    save.type = 'submit'
    save.textContent = 'Set dust'
    save.style.marginLeft = '12px'
    form.append(label, cancel, save)
    dialog.appendChild(form)
    const finish = (value: number | null): void => {
      dialog.close()
      dialog.remove()
      resolve(value)
    }
    cancel.addEventListener('click', () => finish(null))
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(null)
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const value = input.valueAsNumber
      if (!Number.isSafeInteger(value) || value < 0) {
        input.setCustomValidity('Enter a non-negative whole number.')
        input.reportValidity()
        return
      }
      finish(value)
    })
    input.addEventListener('input', () => input.setCustomValidity(''))
    dialog.addEventListener('keydown', (event) => event.stopPropagation())
    dialog.addEventListener('pointerdown', (event) => event.stopPropagation())
    document.body.appendChild(dialog)
    dialog.showModal()
    input.focus()
    input.select()
  })
}
