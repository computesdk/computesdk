// Code generated from YAML configs. DO NOT EDIT.
package css

import (
	"fmt"
	"sync"
	"github.com/heysnelling/computesdk/pkg/ui/css/internal"
)

type Class string

func (c Class) String() string {
	return string(c)
}

// Global class tracker
var (
	usedClasses = make(map[string]bool)
	classMutex  sync.RWMutex
)

// trackClass registers a class as being used
func trackClass(className string) {
	classMutex.Lock()
	defer classMutex.Unlock()
	usedClasses[className] = true
}

// GetUsedClasses returns a slice of all tracked classes
func GetUsedClasses() []string {
	classMutex.RLock()
	defer classMutex.RUnlock()
	
	classes := make([]string, 0, len(usedClasses))
	for class := range usedClasses {
		classes = append(classes, class)
	}
	return classes
}

// ResetTracking clears all tracked classes
func ResetTracking() {
	classMutex.Lock()
	defer classMutex.Unlock()
	usedClasses = make(map[string]bool)
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

// GenerateMinimalCSS generates CSS only for tracked classes
func GenerateMinimalCSS() *Stylesheet {
	return &Stylesheet{internal: internal.GenerateMinimalCSS(GetUsedClasses())}
}


// padding applies padding utility
func P(size int) Class {
	className := fmt.Sprintf("p-%d", size)
	trackClass(className)
	return Class(className)
}


// padding-x applies padding-x utility
func Px(size int) Class {
	className := fmt.Sprintf("px-%d", size)
	trackClass(className)
	return Class(className)
}


// padding-y applies padding-y utility
func Py(size int) Class {
	className := fmt.Sprintf("py-%d", size)
	trackClass(className)
	return Class(className)
}


// padding-top applies padding-top utility
func Pt(size int) Class {
	className := fmt.Sprintf("pt-%d", size)
	trackClass(className)
	return Class(className)
}


// padding-right applies padding-right utility
func Pr(size int) Class {
	className := fmt.Sprintf("pr-%d", size)
	trackClass(className)
	return Class(className)
}


// padding-bottom applies padding-bottom utility
func Pb(size int) Class {
	className := fmt.Sprintf("pb-%d", size)
	trackClass(className)
	return Class(className)
}


// padding-left applies padding-left utility
func Pl(size int) Class {
	className := fmt.Sprintf("pl-%d", size)
	trackClass(className)
	return Class(className)
}


// margin applies margin utility
func M(size int) Class {
	className := fmt.Sprintf("m-%d", size)
	trackClass(className)
	return Class(className)
}


// margin-x applies margin-x utility
func Mx(size int) Class {
	className := fmt.Sprintf("mx-%d", size)
	trackClass(className)
	return Class(className)
}


// margin-y applies margin-y utility
func My(size int) Class {
	className := fmt.Sprintf("my-%d", size)
	trackClass(className)
	return Class(className)
}


// margin-top applies margin-top utility
func Mt(size int) Class {
	className := fmt.Sprintf("mt-%d", size)
	trackClass(className)
	return Class(className)
}


// margin-right applies margin-right utility
func Mr(size int) Class {
	className := fmt.Sprintf("mr-%d", size)
	trackClass(className)
	return Class(className)
}


// margin-bottom applies margin-bottom utility
func Mb(size int) Class {
	className := fmt.Sprintf("mb-%d", size)
	trackClass(className)
	return Class(className)
}


// margin-left applies margin-left utility
func Ml(size int) Class {
	className := fmt.Sprintf("ml-%d", size)
	trackClass(className)
	return Class(className)
}


// BgOrange applies bg-orange-shade utility
func BgOrange(shade int) Class {
	className := fmt.Sprintf("bg-orange-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextOrange applies text-orange-shade utility  
func TextOrange(shade int) Class {
	className := fmt.Sprintf("text-orange-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgEmerald applies bg-emerald-shade utility
func BgEmerald(shade int) Class {
	className := fmt.Sprintf("bg-emerald-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextEmerald applies text-emerald-shade utility  
func TextEmerald(shade int) Class {
	className := fmt.Sprintf("text-emerald-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgViolet applies bg-violet-shade utility
func BgViolet(shade int) Class {
	className := fmt.Sprintf("bg-violet-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextViolet applies text-violet-shade utility  
func TextViolet(shade int) Class {
	className := fmt.Sprintf("text-violet-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgPurple applies bg-purple-shade utility
func BgPurple(shade int) Class {
	className := fmt.Sprintf("bg-purple-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextPurple applies text-purple-shade utility  
func TextPurple(shade int) Class {
	className := fmt.Sprintf("text-purple-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgFuchsia applies bg-fuchsia-shade utility
func BgFuchsia(shade int) Class {
	className := fmt.Sprintf("bg-fuchsia-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextFuchsia applies text-fuchsia-shade utility  
func TextFuchsia(shade int) Class {
	className := fmt.Sprintf("text-fuchsia-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgZinc applies bg-zinc-shade utility
func BgZinc(shade int) Class {
	className := fmt.Sprintf("bg-zinc-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextZinc applies text-zinc-shade utility  
func TextZinc(shade int) Class {
	className := fmt.Sprintf("text-zinc-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgYellow applies bg-yellow-shade utility
func BgYellow(shade int) Class {
	className := fmt.Sprintf("bg-yellow-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextYellow applies text-yellow-shade utility  
func TextYellow(shade int) Class {
	className := fmt.Sprintf("text-yellow-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgGreen applies bg-green-shade utility
func BgGreen(shade int) Class {
	className := fmt.Sprintf("bg-green-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextGreen applies text-green-shade utility  
func TextGreen(shade int) Class {
	className := fmt.Sprintf("text-green-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgSky applies bg-sky-shade utility
func BgSky(shade int) Class {
	className := fmt.Sprintf("bg-sky-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextSky applies text-sky-shade utility  
func TextSky(shade int) Class {
	className := fmt.Sprintf("text-sky-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgBlue applies bg-blue-shade utility
func BgBlue(shade int) Class {
	className := fmt.Sprintf("bg-blue-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextBlue applies text-blue-shade utility  
func TextBlue(shade int) Class {
	className := fmt.Sprintf("text-blue-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgRose applies bg-rose-shade utility
func BgRose(shade int) Class {
	className := fmt.Sprintf("bg-rose-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextRose applies text-rose-shade utility  
func TextRose(shade int) Class {
	className := fmt.Sprintf("text-rose-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgSlate applies bg-slate-shade utility
func BgSlate(shade int) Class {
	className := fmt.Sprintf("bg-slate-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextSlate applies text-slate-shade utility  
func TextSlate(shade int) Class {
	className := fmt.Sprintf("text-slate-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgRed applies bg-red-shade utility
func BgRed(shade int) Class {
	className := fmt.Sprintf("bg-red-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextRed applies text-red-shade utility  
func TextRed(shade int) Class {
	className := fmt.Sprintf("text-red-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgAmber applies bg-amber-shade utility
func BgAmber(shade int) Class {
	className := fmt.Sprintf("bg-amber-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextAmber applies text-amber-shade utility  
func TextAmber(shade int) Class {
	className := fmt.Sprintf("text-amber-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgCyan applies bg-cyan-shade utility
func BgCyan(shade int) Class {
	className := fmt.Sprintf("bg-cyan-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextCyan applies text-cyan-shade utility  
func TextCyan(shade int) Class {
	className := fmt.Sprintf("text-cyan-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgIndigo applies bg-indigo-shade utility
func BgIndigo(shade int) Class {
	className := fmt.Sprintf("bg-indigo-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextIndigo applies text-indigo-shade utility  
func TextIndigo(shade int) Class {
	className := fmt.Sprintf("text-indigo-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgPink applies bg-pink-shade utility
func BgPink(shade int) Class {
	className := fmt.Sprintf("bg-pink-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextPink applies text-pink-shade utility  
func TextPink(shade int) Class {
	className := fmt.Sprintf("text-pink-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgNeutral applies bg-neutral-shade utility
func BgNeutral(shade int) Class {
	className := fmt.Sprintf("bg-neutral-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextNeutral applies text-neutral-shade utility  
func TextNeutral(shade int) Class {
	className := fmt.Sprintf("text-neutral-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgStone applies bg-stone-shade utility
func BgStone(shade int) Class {
	className := fmt.Sprintf("bg-stone-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextStone applies text-stone-shade utility  
func TextStone(shade int) Class {
	className := fmt.Sprintf("text-stone-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgLime applies bg-lime-shade utility
func BgLime(shade int) Class {
	className := fmt.Sprintf("bg-lime-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextLime applies text-lime-shade utility  
func TextLime(shade int) Class {
	className := fmt.Sprintf("text-lime-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgTeal applies bg-teal-shade utility
func BgTeal(shade int) Class {
	className := fmt.Sprintf("bg-teal-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextTeal applies text-teal-shade utility  
func TextTeal(shade int) Class {
	className := fmt.Sprintf("text-teal-%d", shade)
	trackClass(className)
	return Class(className)
}


// BgGray applies bg-gray-shade utility
func BgGray(shade int) Class {
	className := fmt.Sprintf("bg-gray-%d", shade)
	trackClass(className)
	return Class(className)
}


// TextGray applies text-gray-shade utility  
func TextGray(shade int) Class {
	className := fmt.Sprintf("text-gray-%d", shade)
	trackClass(className)
	return Class(className)
}


// Block applies block utility
func Block() Class {
	trackClass("block")
	return "block"
}


// Flex applies flex utility
func Flex() Class {
	trackClass("flex")
	return "flex"
}


// Grid applies grid utility
func Grid() Class {
	trackClass("grid")
	return "grid"
}


// Hidden applies hidden utility
func Hidden() Class {
	trackClass("hidden")
	return "hidden"
}


// Inline applies inline utility
func Inline() Class {
	trackClass("inline")
	return "inline"
}


// InlineBlock applies inline-block utility
func InlineBlock() Class {
	trackClass("inline-block")
	return "inline-block"
}


// InlineFlex applies inline-flex utility
func InlineFlex() Class {
	trackClass("inline-flex")
	return "inline-flex"
}


// InlineGrid applies inline-grid utility
func InlineGrid() Class {
	trackClass("inline-grid")
	return "inline-grid"
}


// JustifyStart applies justify-start utility
func JustifyStart() Class {
	trackClass("justify-start")
	return "justify-start"
}


// JustifyCenter applies justify-center utility
func JustifyCenter() Class {
	trackClass("justify-center")
	return "justify-center"
}


// JustifyEnd applies justify-end utility
func JustifyEnd() Class {
	trackClass("justify-end")
	return "justify-end"
}


// JustifyBetween applies justify-between utility
func JustifyBetween() Class {
	trackClass("justify-between")
	return "justify-between"
}


// JustifyAround applies justify-around utility
func JustifyAround() Class {
	trackClass("justify-around")
	return "justify-around"
}


// JustifyEvenly applies justify-evenly utility
func JustifyEvenly() Class {
	trackClass("justify-evenly")
	return "justify-evenly"
}


// ItemsStart applies items-start utility
func ItemsStart() Class {
	trackClass("items-start")
	return "items-start"
}


// ItemsCenter applies items-center utility
func ItemsCenter() Class {
	trackClass("items-center")
	return "items-center"
}


// ItemsEnd applies items-end utility
func ItemsEnd() Class {
	trackClass("items-end")
	return "items-end"
}


// ItemsStretch applies items-stretch utility
func ItemsStretch() Class {
	trackClass("items-stretch")
	return "items-stretch"
}


// ItemsBaseline applies items-baseline utility
func ItemsBaseline() Class {
	trackClass("items-baseline")
	return "items-baseline"
}


// FlexRow applies flex-row utility
func FlexRow() Class {
	trackClass("flex-row")
	return "flex-row"
}


// FlexCol applies flex-col utility
func FlexCol() Class {
	trackClass("flex-col")
	return "flex-col"
}


// FlexRowReverse applies flex-row-reverse utility
func FlexRowReverse() Class {
	trackClass("flex-row-reverse")
	return "flex-row-reverse"
}


// FlexColReverse applies flex-col-reverse utility
func FlexColReverse() Class {
	trackClass("flex-col-reverse")
	return "flex-col-reverse"
}


// Text8xl applies text-8xl utility
func Text8xl() Class {
	trackClass("text-8xl")
	return "text-8xl"
}


// TextXs applies text-xs utility
func TextXs() Class {
	trackClass("text-xs")
	return "text-xs"
}


// TextSm applies text-sm utility
func TextSm() Class {
	trackClass("text-sm")
	return "text-sm"
}


// TextBase applies text-base utility
func TextBase() Class {
	trackClass("text-base")
	return "text-base"
}


// TextLg applies text-lg utility
func TextLg() Class {
	trackClass("text-lg")
	return "text-lg"
}


// Text2XL applies text-2xl utility
func Text2XL() Class {
	trackClass("text-2xl")
	return "text-2xl"
}


// Text4xl applies text-4xl utility
func Text4xl() Class {
	trackClass("text-4xl")
	return "text-4xl"
}


// Text7xl applies text-7xl utility
func Text7xl() Class {
	trackClass("text-7xl")
	return "text-7xl"
}


// Text9xl applies text-9xl utility
func Text9xl() Class {
	trackClass("text-9xl")
	return "text-9xl"
}


// TextXl applies text-xl utility
func TextXl() Class {
	trackClass("text-xl")
	return "text-xl"
}


// Text3XL applies text-3xl utility
func Text3XL() Class {
	trackClass("text-3xl")
	return "text-3xl"
}


// Text5xl applies text-5xl utility
func Text5xl() Class {
	trackClass("text-5xl")
	return "text-5xl"
}


// Text6xl applies text-6xl utility
func Text6xl() Class {
	trackClass("text-6xl")
	return "text-6xl"
}


// TextLeft applies text-left utility
func TextLeft() Class {
	trackClass("text-left")
	return "text-left"
}


// TextCenter applies text-center utility
func TextCenter() Class {
	trackClass("text-center")
	return "text-center"
}


// TextRight applies text-right utility
func TextRight() Class {
	trackClass("text-right")
	return "text-right"
}


// TextJustify applies text-justify utility
func TextJustify() Class {
	trackClass("text-justify")
	return "text-justify"
}


// FontThin applies font-thin utility
func FontThin() Class {
	trackClass("font-thin")
	return "font-thin"
}


// FontExtralight applies font-extralight utility
func FontExtralight() Class {
	trackClass("font-extralight")
	return "font-extralight"
}


// FontLight applies font-light utility
func FontLight() Class {
	trackClass("font-light")
	return "font-light"
}


// FontNormal applies font-normal utility
func FontNormal() Class {
	trackClass("font-normal")
	return "font-normal"
}


// FontMedium applies font-medium utility
func FontMedium() Class {
	trackClass("font-medium")
	return "font-medium"
}


// FontSemibold applies font-semibold utility
func FontSemibold() Class {
	trackClass("font-semibold")
	return "font-semibold"
}


// FontBold applies font-bold utility
func FontBold() Class {
	trackClass("font-bold")
	return "font-bold"
}


// FontExtrabold applies font-extrabold utility
func FontExtrabold() Class {
	trackClass("font-extrabold")
	return "font-extrabold"
}


// FontBlack applies font-black utility
func FontBlack() Class {
	trackClass("font-black")
	return "font-black"
}


// FontSans applies font-sans utility
func FontSans() Class {
	trackClass("font-sans")
	return "font-sans"
}


// FontSerif applies font-serif utility
func FontSerif() Class {
	trackClass("font-serif")
	return "font-serif"
}


// FontMono applies font-mono utility
func FontMono() Class {
	trackClass("font-mono")
	return "font-mono"
}


// Border applies border utility
func Border(width int) Class {
	className := fmt.Sprintf("border-%d", width)
	trackClass(className)
	return Class(className)
}


// BorderT applies border-t utility
func BorderT(width int) Class {
	className := fmt.Sprintf("border-t-%d", width)
	trackClass(className)
	return Class(className)
}


// BorderR applies border-r utility
func BorderR(width int) Class {
	className := fmt.Sprintf("border-r-%d", width)
	trackClass(className)
	return Class(className)
}


// BorderB applies border-b utility
func BorderB(width int) Class {
	className := fmt.Sprintf("border-b-%d", width)
	trackClass(className)
	return Class(className)
}


// BorderL applies border-l utility
func BorderL(width int) Class {
	className := fmt.Sprintf("border-l-%d", width)
	trackClass(className)
	return Class(className)
}


// Rounded applies rounded utility
func Rounded(radius int) Class {
	className := fmt.Sprintf("rounded-%d", radius)
	trackClass(className)
	return Class(className)
}


// RoundedT applies rounded-t utility
func RoundedT(radius int) Class {
	className := fmt.Sprintf("rounded-t-%d", radius)
	trackClass(className)
	return Class(className)
}


// RoundedR applies rounded-r utility
func RoundedR(radius int) Class {
	className := fmt.Sprintf("rounded-r-%d", radius)
	trackClass(className)
	return Class(className)
}


// RoundedB applies rounded-b utility
func RoundedB(radius int) Class {
	className := fmt.Sprintf("rounded-b-%d", radius)
	trackClass(className)
	return Class(className)
}


// RoundedL applies rounded-l utility
func RoundedL(radius int) Class {
	className := fmt.Sprintf("rounded-l-%d", radius)
	trackClass(className)
	return Class(className)
}


// RoundedTl applies rounded-tl utility
func RoundedTl(radius int) Class {
	className := fmt.Sprintf("rounded-tl-%d", radius)
	trackClass(className)
	return Class(className)
}


// RoundedTr applies rounded-tr utility
func RoundedTr(radius int) Class {
	className := fmt.Sprintf("rounded-tr-%d", radius)
	trackClass(className)
	return Class(className)
}


// RoundedBr applies rounded-br utility
func RoundedBr(radius int) Class {
	className := fmt.Sprintf("rounded-br-%d", radius)
	trackClass(className)
	return Class(className)
}


// RoundedBl applies rounded-bl utility
func RoundedBl(radius int) Class {
	className := fmt.Sprintf("rounded-bl-%d", radius)
	trackClass(className)
	return Class(className)
}


// RoundedFull applies rounded-full utility
func RoundedFull() Class {
	trackClass("rounded-full")
	return "rounded-full"
}


// RoundedNone applies rounded-none utility
func RoundedNone() Class {
	trackClass("rounded-none")
	return "rounded-none"
}


// W applies width utility
func W(size string) Class {
	className := fmt.Sprintf("w-%s", size)
	trackClass(className)
	return Class(className)
}


// H applies height utility
func H(size string) Class {
	className := fmt.Sprintf("h-%s", size)
	trackClass(className)
	return Class(className)
}


// MaxW applies max-width utility
func MaxW(size string) Class {
	className := fmt.Sprintf("max-w-%s", size)
	trackClass(className)
	return Class(className)
}


// MinW applies min-width utility
func MinW(size string) Class {
	className := fmt.Sprintf("min-w-%s", size)
	trackClass(className)
	return Class(className)
}


// MaxH applies max-height utility
func MaxH(size string) Class {
	className := fmt.Sprintf("max-h-%s", size)
	trackClass(className)
	return Class(className)
}


// MinH applies min-height utility
func MinH(size string) Class {
	className := fmt.Sprintf("min-h-%s", size)
	trackClass(className)
	return Class(className)
}


// Static applies static utility
func Static() Class {
	trackClass("static")
	return "static"
}


// Fixed applies fixed utility
func Fixed() Class {
	trackClass("fixed")
	return "fixed"
}


// Absolute applies absolute utility
func Absolute() Class {
	trackClass("absolute")
	return "absolute"
}


// Relative applies relative utility
func Relative() Class {
	trackClass("relative")
	return "relative"
}


// Sticky applies sticky utility
func Sticky() Class {
	trackClass("sticky")
	return "sticky"
}


// Top applies top position utility
func Top(value string) Class {
	className := fmt.Sprintf("top-%s", value)
	trackClass(className)
	return Class(className)
}


// Right applies right position utility
func Right(value string) Class {
	className := fmt.Sprintf("right-%s", value)
	trackClass(className)
	return Class(className)
}


// Bottom applies bottom position utility
func Bottom(value string) Class {
	className := fmt.Sprintf("bottom-%s", value)
	trackClass(className)
	return Class(className)
}


// Left applies left position utility
func Left(value string) Class {
	className := fmt.Sprintf("left-%s", value)
	trackClass(className)
	return Class(className)
}


// Inset applies inset utility
func Inset(value string) Class {
	className := fmt.Sprintf("inset-%s", value)
	trackClass(className)
	return Class(className)
}


// InsetX applies horizontal inset utility
func InsetX(value string) Class {
	className := fmt.Sprintf("inset-x-%s", value)
	trackClass(className)
	return Class(className)
}


// InsetY applies vertical inset utility
func InsetY(value string) Class {
	className := fmt.Sprintf("inset-y-%s", value)
	trackClass(className)
	return Class(className)
}


// Z applies z-index utility
func Z(value string) Class {
	className := fmt.Sprintf("z-%s", value)
	trackClass(className)
	return Class(className)
}


// OverflowAuto applies overflow-auto utility
func OverflowAuto() Class {
	trackClass("overflow-auto")
	return "overflow-auto"
}


// OverflowHidden applies overflow-hidden utility
func OverflowHidden() Class {
	trackClass("overflow-hidden")
	return "overflow-hidden"
}


// OverflowVisible applies overflow-visible utility
func OverflowVisible() Class {
	trackClass("overflow-visible")
	return "overflow-visible"
}


// OverflowScroll applies overflow-scroll utility
func OverflowScroll() Class {
	trackClass("overflow-scroll")
	return "overflow-scroll"
}


// OverflowXAuto applies overflow-x-auto utility
func OverflowXAuto() Class {
	trackClass("overflow-x-auto")
	return "overflow-x-auto"
}


// OverflowXHidden applies overflow-x-hidden utility
func OverflowXHidden() Class {
	trackClass("overflow-x-hidden")
	return "overflow-x-hidden"
}


// OverflowXVisible applies overflow-x-visible utility
func OverflowXVisible() Class {
	trackClass("overflow-x-visible")
	return "overflow-x-visible"
}


// OverflowXScroll applies overflow-x-scroll utility
func OverflowXScroll() Class {
	trackClass("overflow-x-scroll")
	return "overflow-x-scroll"
}


// OverflowYAuto applies overflow-y-auto utility
func OverflowYAuto() Class {
	trackClass("overflow-y-auto")
	return "overflow-y-auto"
}


// OverflowYHidden applies overflow-y-hidden utility
func OverflowYHidden() Class {
	trackClass("overflow-y-hidden")
	return "overflow-y-hidden"
}


// OverflowYVisible applies overflow-y-visible utility
func OverflowYVisible() Class {
	trackClass("overflow-y-visible")
	return "overflow-y-visible"
}


// OverflowYScroll applies overflow-y-scroll utility
func OverflowYScroll() Class {
	trackClass("overflow-y-scroll")
	return "overflow-y-scroll"
}


// Opacity applies opacity utility
func Opacity(value int) Class {
	className := fmt.Sprintf("opacity-%d", value)
	trackClass(className)
	return Class(className)
}


// Shadow applies shadow utility
func Shadow(size ...string) Class {
	var className string
	if len(size) > 0 && size[0] != "" {
		className = fmt.Sprintf("shadow-%s", size[0])
	} else {
		className = "shadow"
	}
	trackClass(className)
	return Class(className)
}


// CursorAuto applies cursor-auto utility
func CursorAuto() Class {
	trackClass("cursor-auto")
	return "cursor-auto"
}


// CursorDefault applies cursor-default utility
func CursorDefault() Class {
	trackClass("cursor-default")
	return "cursor-default"
}


// CursorPointer applies cursor-pointer utility
func CursorPointer() Class {
	trackClass("cursor-pointer")
	return "cursor-pointer"
}


// CursorWait applies cursor-wait utility
func CursorWait() Class {
	trackClass("cursor-wait")
	return "cursor-wait"
}


// CursorText applies cursor-text utility
func CursorText() Class {
	trackClass("cursor-text")
	return "cursor-text"
}


// CursorMove applies cursor-move utility
func CursorMove() Class {
	trackClass("cursor-move")
	return "cursor-move"
}


// CursorHelp applies cursor-help utility
func CursorHelp() Class {
	trackClass("cursor-help")
	return "cursor-help"
}


// CursorNotAllowed applies cursor-not-allowed utility
func CursorNotAllowed() Class {
	trackClass("cursor-not-allowed")
	return "cursor-not-allowed"
}


// CursorNone applies cursor-none utility
func CursorNone() Class {
	trackClass("cursor-none")
	return "cursor-none"
}


// CursorContextMenu applies cursor-context-menu utility
func CursorContextMenu() Class {
	trackClass("cursor-context-menu")
	return "cursor-context-menu"
}


// CursorProgress applies cursor-progress utility
func CursorProgress() Class {
	trackClass("cursor-progress")
	return "cursor-progress"
}


// CursorCell applies cursor-cell utility
func CursorCell() Class {
	trackClass("cursor-cell")
	return "cursor-cell"
}


// CursorCrosshair applies cursor-crosshair utility
func CursorCrosshair() Class {
	trackClass("cursor-crosshair")
	return "cursor-crosshair"
}


// CursorVerticalText applies cursor-vertical-text utility
func CursorVerticalText() Class {
	trackClass("cursor-vertical-text")
	return "cursor-vertical-text"
}


// CursorAlias applies cursor-alias utility
func CursorAlias() Class {
	trackClass("cursor-alias")
	return "cursor-alias"
}


// CursorCopy applies cursor-copy utility
func CursorCopy() Class {
	trackClass("cursor-copy")
	return "cursor-copy"
}


// CursorNoDrop applies cursor-no-drop utility
func CursorNoDrop() Class {
	trackClass("cursor-no-drop")
	return "cursor-no-drop"
}


// CursorGrab applies cursor-grab utility
func CursorGrab() Class {
	trackClass("cursor-grab")
	return "cursor-grab"
}


// CursorGrabbing applies cursor-grabbing utility
func CursorGrabbing() Class {
	trackClass("cursor-grabbing")
	return "cursor-grabbing"
}


// SelectNone applies select-none utility
func SelectNone() Class {
	trackClass("select-none")
	return "select-none"
}


// SelectText applies select-text utility
func SelectText() Class {
	trackClass("select-text")
	return "select-text"
}


// SelectAll applies select-all utility
func SelectAll() Class {
	trackClass("select-all")
	return "select-all"
}


// SelectAuto applies select-auto utility
func SelectAuto() Class {
	trackClass("select-auto")
	return "select-auto"
}


// PointerEventsNone applies pointer-events-none utility
func PointerEventsNone() Class {
	trackClass("pointer-events-none")
	return "pointer-events-none"
}


// PointerEventsAuto applies pointer-events-auto utility
func PointerEventsAuto() Class {
	trackClass("pointer-events-auto")
	return "pointer-events-auto"
}


// Visible applies visible utility
func Visible() Class {
	trackClass("visible")
	return "visible"
}


// Invisible applies invisible utility
func Invisible() Class {
	trackClass("invisible")
	return "invisible"
}


// Collapse applies collapse utility
func Collapse() Class {
	trackClass("collapse")
	return "collapse"
}


// SrOnly applies sr-only utility
func SrOnly() Class {
	trackClass("sr-only")
	return "sr-only"
}


// NotSrOnly applies not-sr-only utility
func NotSrOnly() Class {
	trackClass("not-sr-only")
	return "not-sr-only"
}

