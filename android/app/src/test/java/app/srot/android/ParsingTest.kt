package app.srot.android

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ParsingTest {

    // A trimmed copy of what yt-dlp -J prints for a YouTube video.
    private val youtube = JSONObject(
        """
        {"id":"abc123","title":"Phase diagrams, lecture 7","uploader":"Prof","duration":615.0,
         "thumbnail":"https://i.ytimg.com/vi/abc123/hq.jpg","extractor_key":"Youtube",
         "formats":[
          {"format_id":"sb0","ext":"mhtml","vcodec":"none","acodec":"none","height":45,"width":80},
          {"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","tbr":129.5,"filesize":9000000},
          {"format_id":"251","ext":"webm","vcodec":"none","acodec":"opus","tbr":140.0,"filesize":9500000},
          {"format_id":"18","ext":"mp4","vcodec":"avc1.42001E","acodec":"mp4a.40.2","height":360,"width":640,"tbr":500,"filesize":30000000},
          {"format_id":"136","ext":"mp4","vcodec":"avc1.4d401f","acodec":"none","height":720,"width":1280,"tbr":1500,"filesize":80000000},
          {"format_id":"247","ext":"webm","vcodec":"vp9","acodec":"none","height":720,"width":1280,"tbr":1700,"filesize":85000000},
          {"format_id":"137","ext":"mp4","vcodec":"avc1.640028","acodec":"none","height":1080,"width":1920,"tbr":3000,"filesize_approx":150000000},
          {"format_id":"313","ext":"webm","vcodec":"vp9","acodec":"none","height":2160,"width":3840,"tbr":12000}
         ]}
        """.trimIndent()
    )

    @Test
    fun youtubeChoicesAreTheResolutionsHighestFirstPlusAudio() {
        val info = InfoParser.parse("https://youtu.be/abc123", youtube)
        assertEquals(listOf("2160", "1080", "720", "360"), info.videoChoices.map { it.key })
        assertEquals(listOf("2160p", "1080p", "720p", "360p"), info.videoChoices.map { it.label })
        assertEquals(listOf("mp3", "m4a"), info.audioChoices.map { it.key })
        assertNull(info.fileChoice)
        assertEquals("Phase diagrams, lecture 7", info.title)
        assertEquals(615, info.durationSec)
        assertEquals("abc123", info.id)
    }

    @Test
    fun videoOnlyFormatsAddTheBestM4aAudioToSizeAndParts() {
        val info = InfoParser.parse("u", youtube)
        val p720 = info.videoChoices.first { it.key == "720" }
        assertEquals(2, p720.parts)
        assertEquals(80000000L + 9000000L, p720.sizeBytes)        // H.264 picked over VP9, plus m4a
        val p360 = info.videoChoices.first { it.key == "360" }
        assertEquals(1, p360.parts)                                // already has sound
        assertEquals(30000000L, p360.sizeBytes)
        assertNull(info.videoChoices.first { it.key == "2160" }.sizeBytes)   // unknown size stays unknown
        assertEquals(150000000L + 9000000L, info.videoChoices.first { it.key == "1080" }.sizeBytes)
    }

    @Test
    fun portraitVideoIsNamedByItsShortSide() {
        val tiktok = JSONObject("""{"id":"t1","title":"clip","formats":[{"ext":"mp4","vcodec":"h264","acodec":"aac","width":1080,"height":1920}]}""")
        assertEquals(listOf("1080p"), InfoParser.parse("u", tiktok).videoChoices.map { it.label })
    }

    @Test
    fun directFileLinkGivesOneFileChoice() {
        val pdf = JSONObject("""{"id":"notes","title":"notes","ext":"pdf","url":"https://x.org/notes.pdf","extractor_key":"Generic"}""")
        val info = InfoParser.parse("https://x.org/notes.pdf", pdf)
        assertTrue(info.videoChoices.isEmpty())
        assertTrue(info.audioChoices.isEmpty())
        assertEquals("PDF file", info.fileChoice?.label)
        assertEquals("file", info.fileChoice?.key)
    }

    @Test
    fun plainFilesAreNamedAfterTheLinkNotYtDlpsGuess() {
        // yt-dlp calls non-media files "unknown_video" and GitHub downloads get a random id as title.
        val pdf = InfoParser.parse(
            "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
            JSONObject("""{"id":"dummy","title":"dummy","ext":"unknown_video"}"""),
        )
        assertEquals("dummy.pdf", pdf.fileName)
        assertEquals("dummy.pdf", pdf.title)
        assertEquals("PDF file", pdf.fileChoice?.label)
        val zip = InfoParser.parse(
            "https://github.com/electron/electron/releases/download/v45.3.0/electron-v45.3.0-linux-x64.zip",
            JSONObject("""{"id":"eecfca78","title":"eecfca78-3a12-4f75-91bf-172b7bb66d2f","ext":"unknown_video"}"""),
        )
        assertEquals("electron-v45.3.0-linux-x64.zip", zip.fileName)
        assertEquals("ZIP file", zip.fileChoice?.label)
    }

    @Test
    fun fileNamesAreDecodedAndCleaned() {
        val j = JSONObject("""{"title":"Report","ext":"pdf"}""")
        assertEquals("Lecture 5.pdf", InfoParser.fileNameFor("https://x.org/files/Lecture%205.pdf?dl=1", j))
        assertEquals("Report.pdf", InfoParser.fileNameFor("https://x.org/download?id=5", j))
        assertEquals("a_b_c.txt", InfoParser.safeName("a/b:c.txt"))
        assertEquals("hidden", InfoParser.safeName("..hidden"))
        val unknown = JSONObject("""{"title":"thing","ext":"unknown_video"}""")
        assertEquals("thing", InfoParser.fileNameFor("https://x.org/get", unknown))
    }

    @Test
    fun audioOnlySiteOffersOnlyAudio() {
        val sc = JSONObject("""{"id":"s1","title":"song","formats":[{"ext":"mp3","vcodec":"none","acodec":"mp3","tbr":128}]}""")
        val info = InfoParser.parse("u", sc)
        assertTrue(info.videoChoices.isEmpty())
        assertEquals(listOf("mp3", "m4a"), info.audioChoices.map { it.key })
    }

    @Test
    fun playlistIsRecognisedAndOffersNothing() {
        val pl = JSONObject("""{"_type":"playlist","id":"PL1","title":"Course","entries":[{"id":"a"}]}""")
        val info = InfoParser.parse("u", pl)
        assertTrue(info.isPlaylist)
        assertTrue(info.allChoices.isEmpty())
    }

    @Test
    fun nullValuesAreTreatedAsMissing() {
        val j = JSONObject("""{"id":"x","title":null,"uploader":null,"duration":null,"formats":[{"ext":"mp4","vcodec":"avc1","acodec":null,"height":480,"width":854,"filesize":null}]}""")
        val info = InfoParser.parse("u", j)
        assertEquals("x", info.title)
        assertNull(info.uploader)
        assertNull(info.durationSec)
        assertEquals(1, info.videoChoices.single().parts)          // unknown audio codec: assume it has sound
        assertNull(info.videoChoices.single().sizeBytes)
    }

    @Test
    fun preferredQualityPicksTheClosestNotAbove() {
        val info = InfoParser.parse("u", youtube)
        assertEquals("720", InfoParser.preferred(info, "1000")?.key)
        assertEquals("2160", InfoParser.preferred(info, "best")?.key)
        assertEquals("mp3", InfoParser.preferred(info, "mp3")?.key)
        assertEquals("360", InfoParser.preferred(info, "144")?.key)  // nothing that low: smallest available
    }

    @Test
    fun progressLinesAreRead() {
        val p = ProgressLine.parse("[download]  45.2% of  120.50MiB at    2.35MiB/s ETA 00:31")!!
        assertEquals(45.2f, p.percent, 0.01f)
        assertEquals((120.5 * 1024 * 1024).toLong(), p.totalBytes)
        assertEquals((2.35 * 1024 * 1024).toLong(), p.speedBps)
        assertEquals(31L, p.etaSec)
        val approx = ProgressLine.parse("[download]  10.0% of ~  80.00MiB at  1.00KiB/s ETA 01:02:03 (frag 3/40)")!!
        assertEquals(3723L, approx.etaSec)
        val unknown = ProgressLine.parse("[download]   0.0% of  280.94MiB at  Unknown B/s ETA Unknown")!!
        assertEquals(0L, unknown.speedBps)
        assertNull(unknown.etaSec)
        assertNull(ProgressLine.parse("[youtube] abc: Downloading webpage"))
    }

    @Test
    fun trackerCombinesVideoAndAudioIntoOnePercentage() {
        val t = ProgressTracker(2)
        t.feed("[download] Destination: x [abc].f137.mp4")
        t.feed("[download]  50.0% of 100.00MiB at 1.00MiB/s ETA 00:50")
        assertEquals(42.5f, t.snapshot().progress, 0.01f)
        assertEquals("Downloading video", t.snapshot().phase)
        t.feed("[download] 100% of 100.00MiB in 00:01:40")
        t.feed("[download] Destination: x [abc].f140.m4a")
        t.feed("[download]  50.0% of 9.00MiB at 1.00MiB/s ETA 00:05")
        assertEquals(92.5f, t.snapshot().progress, 0.01f)
        assertEquals("Downloading sound", t.snapshot().phase)
        t.feed("[Merger] Merging formats into \"x [abc].mp4\"")
        assertEquals("Joining video and sound…", t.snapshot().phase)
        assertEquals(0L, t.snapshot().speedBps)
    }

    @Test
    fun trackerKnowsWhichFileYtDlpProduced() {
        val merge = ProgressTracker(2)
        merge.feed("[download] Destination: /d/Talk [abc].f137.mp4")
        merge.feed("[download] Destination: /d/Talk [abc].f140.m4a")
        merge.feed("[Merger] Merging formats into \"/d/Talk [abc].mp4\"")
        merge.feed("Deleting original file /d/Talk [abc].f137.mp4 (pass -k to keep)")
        assertEquals("/d/Talk [abc].mp4", merge.outputPath())

        val mp3 = ProgressTracker(1)
        mp3.feed("[download] Destination: /d/Song [x].webm")
        mp3.feed("[ExtractAudio] Destination: /d/Song [x].mp3")
        assertEquals("/d/Song [x].mp3", mp3.outputPath())

        val again = ProgressTracker(1)
        again.feed("[download] /d/Film [c].mp4 has already been downloaded")
        assertEquals("/d/Film [c].mp4", again.outputPath())

        val same = ProgressTracker(1)
        same.feed("[download] Destination: /d/a [y].m4a")
        same.feed("[ExtractAudio] Not converting audio /d/a [y].m4a; file is already in target format m4a")
        assertEquals("/d/a [y].m4a", same.outputPath())
    }

    @Test
    fun directVideoLinksCanAlsoBeSavedAsMp3ButDefaultToTheFile() {
        val info = InfoParser.parse(
            "https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/big_buck_bunny.mp4",
            JSONObject("""{"id":"big_buck_bunny","title":"big_buck_bunny","ext":"mp4"}"""),
        )
        assertEquals("MP4 file", info.fileChoice?.label)
        assertEquals(listOf("mp3"), info.audioChoices.map { it.key })
        assertEquals("file", InfoParser.preferred(info, "720")?.key)
        assertEquals("mp3", InfoParser.preferred(info, "mp3")?.key)
        val pdf = InfoParser.parse("https://x.org/a.pdf", JSONObject("""{"id":"a","ext":"pdf"}"""))
        assertTrue(pdf.audioChoices.isEmpty())
    }

    @Test
    fun trackerGrowsWhenMoreFilesAppearThanExpected() {
        val t = ProgressTracker(1)
        t.feed("[download] Destination: a.f1.mp4")
        t.feed("[download] 100% of 10.00MiB")
        t.feed("[download] Destination: a.f2.m4a")
        t.feed("[download]  0.0% of 1.00MiB")
        assertTrue(t.snapshot().progress in 80f..90f)
    }

    @Test
    fun errorsAreShortAndPlain() {
        val raw = "WARNING: something\nERROR: [youtube] abc123: Video unavailable. This video is private. Use --cookies-from-browser or --cookies for the authentication."
        assertEquals("Video unavailable. This video is private.", cleanError(raw))
        assertEquals("Something went wrong", cleanError(null))
        assertEquals("plain failure", cleanError("plain failure"))
        assertEquals(
            "This video has no sound, so there is nothing to save as audio",
            cleanError("Postprocessing: WARNING: unable to obtain file audio codec with ffprobe"),
        )
    }

    @Test
    fun sharedTextYieldsTheLink() {
        assertEquals("https://youtu.be/abc123?si=x", firstUrl("Watch this! https://youtu.be/abc123?si=x via app"))
        assertEquals("https://www.facebook.com/watch?v=1", firstUrl("(https://www.facebook.com/watch?v=1)."))
        assertNull(firstUrl("no link here"))
        assertNull(firstUrl(null))
    }

    @Test
    fun finishedFilesAreToldApartFromPieces() {
        assertTrue(Storage.isFinal("Lecture [abc123].mp4", "abc123"))
        assertTrue(Storage.isFinal("Lecture [abc123].mp3", "abc123"))
        assertFalse(Storage.isFinal("Lecture [abc123].f137.mp4", "abc123"))
        assertFalse(Storage.isFinal("Lecture [abc123].mp4.part", "abc123"))
        assertFalse(Storage.isFinal("Lecture [abc123].f140.m4a.ytdl", "abc123"))
        assertFalse(Storage.isFinal("Lecture [abc123].temp.mp4", "abc123"))
    }

    @Test
    fun downloadItemSurvivesASaveAndLoad() {
        val item = DownloadItem(
            id = "1", url = "https://youtu.be/abc", title = "T", thumbnail = null, uploader = "U", durationSec = 61,
            mediaId = "abc", kind = Kind.VIDEO, choiceKey = "720", choiceLabel = "720p", parts = 2, cookieFile = null,
            status = Status.PAUSED, progress = 42.5f, sizeBytes = 1234L, addedAt = 99L,
            fileName = "notes.pdf", targetPath = "/sdcard/Download/Srot/notes.pdf",
        )
        val back = DownloadItem.fromJson(JSONObject(item.toJson().toString()))!!
        assertEquals(item, back)
        assertNull(DownloadItem.fromJson(JSONObject("""{"nope":1}""")))
    }
}
