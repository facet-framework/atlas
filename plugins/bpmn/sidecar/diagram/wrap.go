package diagram

import (
	"strings"
	"unicode/utf8"
)

// maxLabelLines bounds one label. A name long enough for more is cut, and
// the last line says so with an ellipsis rather than overflowing its shape.
const maxLabelLines = 6

// wrap breaks text into lines no wider than width, by the estimated advance
// of charWidth per character. Explicit line breaks in the name are kept. A
// single word wider than the line is split, not left to overflow: a long
// identifier in a task name is common, and a box with text spilling out of
// it reads as broken.
func wrap(text string, width float64) []string {
	return wrapText(text, width, true)
}

// wrapWords breaks only at spaces, never inside a word. Used for a box the
// file itself gives (BPMNLabel bounds): the modeller sized it for the text
// as their tool drew it, and charWidth is an estimate that errs wide on
// purpose — splitting "repo.read" into "repo.rea" / "d" because the estimate
// said it would not fit second-guesses a box somebody chose.
func wrapWords(text string, width float64) []string {
	return wrapText(text, width, false)
}

func wrapText(text string, width float64, splitWords bool) []string {
	perLine := int(width / charWidth)
	if perLine < 4 {
		perLine = 4
	}
	var lines []string
	for _, para := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line := ""
		for _, word := range strings.Fields(para) {
			for splitWords && utf8.RuneCountInString(word) > perLine {
				if line != "" {
					lines = append(lines, line)
					line = ""
				}
				head, tail := splitRunes(word, perLine)
				lines = append(lines, head)
				word = tail
			}
			switch {
			case line == "":
				line = word
			case utf8.RuneCountInString(line)+1+utf8.RuneCountInString(word) <= perLine:
				line += " " + word
			default:
				lines = append(lines, line)
				line = word
			}
		}
		if line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) > maxLabelLines {
		lines = lines[:maxLabelLines]
		last := []rune(lines[maxLabelLines-1])
		if len(last) >= perLine {
			last = last[:perLine-1]
		}
		lines[maxLabelLines-1] = string(last) + "…"
	}
	if lines == nil {
		lines = []string{}
	}
	return lines
}

func splitRunes(s string, n int) (string, string) {
	r := []rune(s)
	return string(r[:n]), string(r[n:])
}
