// Code generated from YAML configs. DO NOT EDIT.
package css

import (
	"fmt"
	"github.com/heysnelling/computesdk/pkg/ui/css/internal"
)

type Class string

func (c Class) String() string {
	return string(c)
}

// Stylesheet wraps the internal stylesheet type
type Stylesheet struct {
	internal interface{ GenerateCSS() string }
}

// Generate returns the CSS string
func (s *Stylesheet) Generate() string {
	if s.internal == nil {
		return ""
	}
	if gen, ok := s.internal.(interface{ GenerateCSS() string }); ok {
		return gen.GenerateCSS()
	}
	return ""
}

// GenerateUtilities creates CSS rules using the config-driven approach
func GenerateUtilities() *Stylesheet {
	return &Stylesheet{internal: internal.GenerateUtilities()}
}


// padding applies padding utility
func P(size int) Class {
	return Class(fmt.Sprintf("p-%d", size))
}


// padding-x applies padding-x utility
func Px(size int) Class {
	return Class(fmt.Sprintf("px-%d", size))
}


// padding-y applies padding-y utility
func Py(size int) Class {
	return Class(fmt.Sprintf("py-%d", size))
}


// padding-top applies padding-top utility
func Pt(size int) Class {
	return Class(fmt.Sprintf("pt-%d", size))
}


// padding-right applies padding-right utility
func Pr(size int) Class {
	return Class(fmt.Sprintf("pr-%d", size))
}


// padding-bottom applies padding-bottom utility
func Pb(size int) Class {
	return Class(fmt.Sprintf("pb-%d", size))
}


// padding-left applies padding-left utility
func Pl(size int) Class {
	return Class(fmt.Sprintf("pl-%d", size))
}


// margin applies margin utility
func M(size int) Class {
	return Class(fmt.Sprintf("m-%d", size))
}


// margin-x applies margin-x utility
func Mx(size int) Class {
	return Class(fmt.Sprintf("mx-%d", size))
}


// margin-y applies margin-y utility
func My(size int) Class {
	return Class(fmt.Sprintf("my-%d", size))
}


// margin-top applies margin-top utility
func Mt(size int) Class {
	return Class(fmt.Sprintf("mt-%d", size))
}


// margin-right applies margin-right utility
func Mr(size int) Class {
	return Class(fmt.Sprintf("mr-%d", size))
}


// margin-bottom applies margin-bottom utility
func Mb(size int) Class {
	return Class(fmt.Sprintf("mb-%d", size))
}


// margin-left applies margin-left utility
func Ml(size int) Class {
	return Class(fmt.Sprintf("ml-%d", size))
}


// BgOrange applies bg-orange-shade utility
func BgOrange(shade int) Class {
	return Class(fmt.Sprintf("bg-orange-%d", shade))
}


// TextOrange applies text-orange-shade utility  
func TextOrange(shade int) Class {
	return Class(fmt.Sprintf("text-orange-%d", shade))
}


// BgGreen applies bg-green-shade utility
func BgGreen(shade int) Class {
	return Class(fmt.Sprintf("bg-green-%d", shade))
}


// TextGreen applies text-green-shade utility  
func TextGreen(shade int) Class {
	return Class(fmt.Sprintf("text-green-%d", shade))
}


// BgSky applies bg-sky-shade utility
func BgSky(shade int) Class {
	return Class(fmt.Sprintf("bg-sky-%d", shade))
}


// TextSky applies text-sky-shade utility  
func TextSky(shade int) Class {
	return Class(fmt.Sprintf("text-sky-%d", shade))
}


// BgRose applies bg-rose-shade utility
func BgRose(shade int) Class {
	return Class(fmt.Sprintf("bg-rose-%d", shade))
}


// TextRose applies text-rose-shade utility  
func TextRose(shade int) Class {
	return Class(fmt.Sprintf("text-rose-%d", shade))
}


// BgGray applies bg-gray-shade utility
func BgGray(shade int) Class {
	return Class(fmt.Sprintf("bg-gray-%d", shade))
}


// TextGray applies text-gray-shade utility  
func TextGray(shade int) Class {
	return Class(fmt.Sprintf("text-gray-%d", shade))
}


// BgZinc applies bg-zinc-shade utility
func BgZinc(shade int) Class {
	return Class(fmt.Sprintf("bg-zinc-%d", shade))
}


// TextZinc applies text-zinc-shade utility  
func TextZinc(shade int) Class {
	return Class(fmt.Sprintf("text-zinc-%d", shade))
}


// BgYellow applies bg-yellow-shade utility
func BgYellow(shade int) Class {
	return Class(fmt.Sprintf("bg-yellow-%d", shade))
}


// TextYellow applies text-yellow-shade utility  
func TextYellow(shade int) Class {
	return Class(fmt.Sprintf("text-yellow-%d", shade))
}


// BgLime applies bg-lime-shade utility
func BgLime(shade int) Class {
	return Class(fmt.Sprintf("bg-lime-%d", shade))
}


// TextLime applies text-lime-shade utility  
func TextLime(shade int) Class {
	return Class(fmt.Sprintf("text-lime-%d", shade))
}


// BgCyan applies bg-cyan-shade utility
func BgCyan(shade int) Class {
	return Class(fmt.Sprintf("bg-cyan-%d", shade))
}


// TextCyan applies text-cyan-shade utility  
func TextCyan(shade int) Class {
	return Class(fmt.Sprintf("text-cyan-%d", shade))
}


// BgBlue applies bg-blue-shade utility
func BgBlue(shade int) Class {
	return Class(fmt.Sprintf("bg-blue-%d", shade))
}


// TextBlue applies text-blue-shade utility  
func TextBlue(shade int) Class {
	return Class(fmt.Sprintf("text-blue-%d", shade))
}


// BgViolet applies bg-violet-shade utility
func BgViolet(shade int) Class {
	return Class(fmt.Sprintf("bg-violet-%d", shade))
}


// TextViolet applies text-violet-shade utility  
func TextViolet(shade int) Class {
	return Class(fmt.Sprintf("text-violet-%d", shade))
}


// BgEmerald applies bg-emerald-shade utility
func BgEmerald(shade int) Class {
	return Class(fmt.Sprintf("bg-emerald-%d", shade))
}


// TextEmerald applies text-emerald-shade utility  
func TextEmerald(shade int) Class {
	return Class(fmt.Sprintf("text-emerald-%d", shade))
}


// BgIndigo applies bg-indigo-shade utility
func BgIndigo(shade int) Class {
	return Class(fmt.Sprintf("bg-indigo-%d", shade))
}


// TextIndigo applies text-indigo-shade utility  
func TextIndigo(shade int) Class {
	return Class(fmt.Sprintf("text-indigo-%d", shade))
}


// BgPurple applies bg-purple-shade utility
func BgPurple(shade int) Class {
	return Class(fmt.Sprintf("bg-purple-%d", shade))
}


// TextPurple applies text-purple-shade utility  
func TextPurple(shade int) Class {
	return Class(fmt.Sprintf("text-purple-%d", shade))
}


// BgFuchsia applies bg-fuchsia-shade utility
func BgFuchsia(shade int) Class {
	return Class(fmt.Sprintf("bg-fuchsia-%d", shade))
}


// TextFuchsia applies text-fuchsia-shade utility  
func TextFuchsia(shade int) Class {
	return Class(fmt.Sprintf("text-fuchsia-%d", shade))
}


// BgSlate applies bg-slate-shade utility
func BgSlate(shade int) Class {
	return Class(fmt.Sprintf("bg-slate-%d", shade))
}


// TextSlate applies text-slate-shade utility  
func TextSlate(shade int) Class {
	return Class(fmt.Sprintf("text-slate-%d", shade))
}


// BgRed applies bg-red-shade utility
func BgRed(shade int) Class {
	return Class(fmt.Sprintf("bg-red-%d", shade))
}


// TextRed applies text-red-shade utility  
func TextRed(shade int) Class {
	return Class(fmt.Sprintf("text-red-%d", shade))
}


// BgAmber applies bg-amber-shade utility
func BgAmber(shade int) Class {
	return Class(fmt.Sprintf("bg-amber-%d", shade))
}


// TextAmber applies text-amber-shade utility  
func TextAmber(shade int) Class {
	return Class(fmt.Sprintf("text-amber-%d", shade))
}


// BgTeal applies bg-teal-shade utility
func BgTeal(shade int) Class {
	return Class(fmt.Sprintf("bg-teal-%d", shade))
}


// TextTeal applies text-teal-shade utility  
func TextTeal(shade int) Class {
	return Class(fmt.Sprintf("text-teal-%d", shade))
}


// BgPink applies bg-pink-shade utility
func BgPink(shade int) Class {
	return Class(fmt.Sprintf("bg-pink-%d", shade))
}


// TextPink applies text-pink-shade utility  
func TextPink(shade int) Class {
	return Class(fmt.Sprintf("text-pink-%d", shade))
}


// BgNeutral applies bg-neutral-shade utility
func BgNeutral(shade int) Class {
	return Class(fmt.Sprintf("bg-neutral-%d", shade))
}


// TextNeutral applies text-neutral-shade utility  
func TextNeutral(shade int) Class {
	return Class(fmt.Sprintf("text-neutral-%d", shade))
}


// BgStone applies bg-stone-shade utility
func BgStone(shade int) Class {
	return Class(fmt.Sprintf("bg-stone-%d", shade))
}


// TextStone applies text-stone-shade utility  
func TextStone(shade int) Class {
	return Class(fmt.Sprintf("text-stone-%d", shade))
}


// Block applies block utility
func Block() Class {
	return "block"
}


// Flex applies flex utility
func Flex() Class {
	return "flex"
}


// Grid applies grid utility
func Grid() Class {
	return "grid"
}


// Hidden applies hidden utility
func Hidden() Class {
	return "hidden"
}


// Inline applies inline utility
func Inline() Class {
	return "inline"
}


// InlineBlock applies inline-block utility
func InlineBlock() Class {
	return "inline-block"
}


// InlineFlex applies inline-flex utility
func InlineFlex() Class {
	return "inline-flex"
}


// InlineGrid applies inline-grid utility
func InlineGrid() Class {
	return "inline-grid"
}


// JustifyStart applies justify-start utility
func JustifyStart() Class {
	return "justify-start"
}


// JustifyCenter applies justify-center utility
func JustifyCenter() Class {
	return "justify-center"
}


// JustifyEnd applies justify-end utility
func JustifyEnd() Class {
	return "justify-end"
}


// JustifyBetween applies justify-between utility
func JustifyBetween() Class {
	return "justify-between"
}


// JustifyAround applies justify-around utility
func JustifyAround() Class {
	return "justify-around"
}


// JustifyEvenly applies justify-evenly utility
func JustifyEvenly() Class {
	return "justify-evenly"
}


// ItemsStart applies items-start utility
func ItemsStart() Class {
	return "items-start"
}


// ItemsCenter applies items-center utility
func ItemsCenter() Class {
	return "items-center"
}


// ItemsEnd applies items-end utility
func ItemsEnd() Class {
	return "items-end"
}


// ItemsStretch applies items-stretch utility
func ItemsStretch() Class {
	return "items-stretch"
}


// ItemsBaseline applies items-baseline utility
func ItemsBaseline() Class {
	return "items-baseline"
}


// FlexRow applies flex-row utility
func FlexRow() Class {
	return "flex-row"
}


// FlexCol applies flex-col utility
func FlexCol() Class {
	return "flex-col"
}


// FlexRowReverse applies flex-row-reverse utility
func FlexRowReverse() Class {
	return "flex-row-reverse"
}


// FlexColReverse applies flex-col-reverse utility
func FlexColReverse() Class {
	return "flex-col-reverse"
}


// Text8xl applies text-8xl utility
func Text8xl() Class {
	return "text-8xl"
}


// Text9xl applies text-9xl utility
func Text9xl() Class {
	return "text-9xl"
}


// TextXs applies text-xs utility
func TextXs() Class {
	return "text-xs"
}


// TextSm applies text-sm utility
func TextSm() Class {
	return "text-sm"
}


// TextBase applies text-base utility
func TextBase() Class {
	return "text-base"
}


// TextLg applies text-lg utility
func TextLg() Class {
	return "text-lg"
}


// TextXl applies text-xl utility
func TextXl() Class {
	return "text-xl"
}


// Text2XL applies text-2xl utility
func Text2XL() Class {
	return "text-2xl"
}


// Text4xl applies text-4xl utility
func Text4xl() Class {
	return "text-4xl"
}


// Text6xl applies text-6xl utility
func Text6xl() Class {
	return "text-6xl"
}


// Text3XL applies text-3xl utility
func Text3XL() Class {
	return "text-3xl"
}


// Text5xl applies text-5xl utility
func Text5xl() Class {
	return "text-5xl"
}


// Text7xl applies text-7xl utility
func Text7xl() Class {
	return "text-7xl"
}


// TextLeft applies text-left utility
func TextLeft() Class {
	return "text-left"
}


// TextCenter applies text-center utility
func TextCenter() Class {
	return "text-center"
}


// TextRight applies text-right utility
func TextRight() Class {
	return "text-right"
}


// TextJustify applies text-justify utility
func TextJustify() Class {
	return "text-justify"
}


// FontThin applies font-thin utility
func FontThin() Class {
	return "font-thin"
}


// FontExtralight applies font-extralight utility
func FontExtralight() Class {
	return "font-extralight"
}


// FontLight applies font-light utility
func FontLight() Class {
	return "font-light"
}


// FontNormal applies font-normal utility
func FontNormal() Class {
	return "font-normal"
}


// FontMedium applies font-medium utility
func FontMedium() Class {
	return "font-medium"
}


// FontSemibold applies font-semibold utility
func FontSemibold() Class {
	return "font-semibold"
}


// FontBold applies font-bold utility
func FontBold() Class {
	return "font-bold"
}


// FontExtrabold applies font-extrabold utility
func FontExtrabold() Class {
	return "font-extrabold"
}


// FontBlack applies font-black utility
func FontBlack() Class {
	return "font-black"
}


// Border applies border utility
func Border(width int) Class {
	return Class(fmt.Sprintf("border-%d", width))
}


// BorderT applies border-t utility
func BorderT(width int) Class {
	return Class(fmt.Sprintf("border-t-%d", width))
}


// BorderR applies border-r utility
func BorderR(width int) Class {
	return Class(fmt.Sprintf("border-r-%d", width))
}


// BorderB applies border-b utility
func BorderB(width int) Class {
	return Class(fmt.Sprintf("border-b-%d", width))
}


// BorderL applies border-l utility
func BorderL(width int) Class {
	return Class(fmt.Sprintf("border-l-%d", width))
}


// Rounded applies rounded utility
func Rounded(radius int) Class {
	return Class(fmt.Sprintf("rounded-%d", radius))
}


// RoundedT applies rounded-t utility
func RoundedT(radius int) Class {
	return Class(fmt.Sprintf("rounded-t-%d", radius))
}


// RoundedR applies rounded-r utility
func RoundedR(radius int) Class {
	return Class(fmt.Sprintf("rounded-r-%d", radius))
}


// RoundedB applies rounded-b utility
func RoundedB(radius int) Class {
	return Class(fmt.Sprintf("rounded-b-%d", radius))
}


// RoundedL applies rounded-l utility
func RoundedL(radius int) Class {
	return Class(fmt.Sprintf("rounded-l-%d", radius))
}


// RoundedTl applies rounded-tl utility
func RoundedTl(radius int) Class {
	return Class(fmt.Sprintf("rounded-tl-%d", radius))
}


// RoundedTr applies rounded-tr utility
func RoundedTr(radius int) Class {
	return Class(fmt.Sprintf("rounded-tr-%d", radius))
}


// RoundedBr applies rounded-br utility
func RoundedBr(radius int) Class {
	return Class(fmt.Sprintf("rounded-br-%d", radius))
}


// RoundedBl applies rounded-bl utility
func RoundedBl(radius int) Class {
	return Class(fmt.Sprintf("rounded-bl-%d", radius))
}


// RoundedFull applies rounded-full utility
func RoundedFull() Class {
	return "rounded-full"
}


// RoundedNone applies rounded-none utility
func RoundedNone() Class {
	return "rounded-none"
}

