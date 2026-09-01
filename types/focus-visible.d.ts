/**
 * `focus({ focusVisible: true })`.
 *
 * The option is in the HTML standard and Chrome implements it; TypeScript's DOM
 * lib has not caught up. It is how a script asks for the focus ring on a move the
 * product made rather than the person — a refusal landing on the field it is
 * about, a build ending landing on its own button. Without it the browser judges
 * that focus by how the person last interacted, which after a mouse click means a
 * control that is not a text input rings nothing (PLAN decision 45).
 */
interface FocusOptions {
  focusVisible?: boolean;
}
