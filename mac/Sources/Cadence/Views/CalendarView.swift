import SwiftUI

struct CalendarView: View {
    let posts: [Post]
    let select: (Post) -> Void
    @State private var month = Date()
    private let calendar = Calendar.current
    private var days: [Date?] {
        guard let interval = calendar.dateInterval(of: .month, for: month), let range = calendar.range(of: .day, in: .month, for: month) else { return [] }
        let offset = (calendar.component(.weekday, from: interval.start) - calendar.firstWeekday + 7) % 7
        return Array(repeating: nil, count: offset) + range.compactMap { calendar.date(byAdding: .day, value: $0 - 1, to: interval.start) }.map(Optional.some)
    }
    private var weekdays: [String] {
        let symbols = calendar.shortWeekdaySymbols
        let offset = calendar.firstWeekday - 1
        return Array(symbols[offset...] + symbols[..<offset])
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text(month, format: .dateTime.month(.wide).year()).font(.title2.weight(.medium))
                Spacer()
                Button { move(-1) } label: { Image(systemName: "chevron.left") }.help("Previous month")
                Button("Today") { month = Date() }
                Button { move(1) } label: { Image(systemName: "chevron.right") }.help("Next month")
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 7), spacing: 6) {
                ForEach(Array(weekdays.enumerated()), id: \.offset) { _, day in Text(day.uppercased()).font(.caption.weight(.medium)).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.bottom, 8) }
                ForEach(Array(days.enumerated()), id: \.offset) { _, date in
                    if let date {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(date, format: .dateTime.day()).font(.callout.weight(calendar.isDateInToday(date) ? .bold : .regular)).foregroundStyle(calendar.isDateInToday(date) ? .teal : .primary)
                            ForEach(posts.filter { post in post.date.map { calendar.isDate($0, inSameDayAs: date) } ?? false }) { post in
                                Button { select(post) } label: { Text(post.title).font(.caption).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading).padding(6).background(.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 5)) }.buttonStyle(.plain)
                            }
                            Spacer(minLength: 0)
                        }.padding(10).frame(maxWidth: .infinity, minHeight: 115, alignment: .topLeading).background(.background, in: RoundedRectangle(cornerRadius: 8))
                    } else { Color.clear.frame(minHeight: 115) }
                }
            }
            Text("Times are shown in \(TimeZone.current.identifier).").font(.caption).foregroundStyle(.secondary)
        }
    }
    private func move(_ value: Int) { if let date = calendar.date(byAdding: .month, value: value, to: month) { month = date } }
}
