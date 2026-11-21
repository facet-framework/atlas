import ts from "typescript";

// Inspect only text rendered by JSX. Calls and identifiers may contain translated
// labels or project content, so their arguments are deliberately not inspected.

export function untranslatedJsx(source, filename = "source.tsx") {
  const tree = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings = [];
  const prose = (text) => /[A-Za-zÀ-ž]/.test(text);
  const report = (node, text) => {
    if (prose(text)) {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      findings.push({ line: line + 1, text: text.trim() });
    }
  };
  const rendered = (node) => {
    if (!node) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      report(node, node.text);
    else if (ts.isConditionalExpression(node)) {
      rendered(node.whenTrue);
      rendered(node.whenFalse);
    } else if (ts.isTemplateExpression(node)) {
      report(node.head, node.head.text);
      for (const span of node.templateSpans) {
        report(span.literal, span.literal.text);
        rendered(span.expression);
      }
    } else if (ts.isParenthesizedExpression(node)) rendered(node.expression);
  };
  const inspect = (node) => {
    if (ts.isJsxText(node)) report(node, node.text);
    if (
      ts.isJsxAttribute(node) &&
      ["title", "aria-label", "placeholder", "alt"].includes(node.name.text)
    ) {
      if (node.initializer && ts.isStringLiteral(node.initializer))
        report(node.initializer, node.initializer.text);
      else if (node.initializer && ts.isJsxExpression(node.initializer))
        rendered(node.initializer.expression);
    }
    if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const isCode =
        ts.isJsxElement(node.parent) && node.parent.openingElement.tagName.getText(tree) === "code";
      if (!isCode) rendered(node.expression);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(tree);
  return findings;
}
// @facet: workspace/contracts/label-keys
// @facet-role: primary
