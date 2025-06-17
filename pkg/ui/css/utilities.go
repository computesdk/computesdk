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
	return "text-8xl"
}


// TextBase applies text-base utility
func TextBase() Class {
	return "text-base"
}


// TextLg applies text-lg utility
func TextLg() Class {
	return "text-lg"
}


// Text3XL applies text-3xl utility
func Text3XL() Class {
	return "text-3xl"
}


// Text6xl applies text-6xl utility
func Text6xl() Class {
	return "text-6xl"
}


// Text7xl applies text-7xl utility
func Text7xl() Class {
	return "text-7xl"
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


// Text5xl applies text-5xl utility
func Text5xl() Class {
	return "text-5xl"
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

