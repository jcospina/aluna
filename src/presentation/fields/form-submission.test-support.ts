// What a rendered form submits, read from its markup, so a suite proves what the form sends rather
// than restating it. Inputs only: a checkbox or radio counts when it is checked, and a form with a
// `<select>` or `<textarea>` needs more than this reads.

export async function submittedInputs(html: string): Promise<[name: string, value: string][]> {
  const pairs: [string, string][] = [];
  const rewriter = new HTMLRewriter().on("input[name]", {
    element(element) {
      const type = element.getAttribute("type");
      const toggled = type === "checkbox" || type === "radio";
      if (toggled && !element.hasAttribute("checked")) return;
      const fallback = toggled ? "on" : "";
      pairs.push([element.getAttribute("name") ?? "", element.getAttribute("value") ?? fallback]);
    },
  });
  await new Response(rewriter.transform(new Response(html)).body).text();
  return pairs;
}
