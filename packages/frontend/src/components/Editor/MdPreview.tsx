import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
    content: string;
}

export default function MdPreview({ content }: Props) {
    return (
        <div className="prose prose-invert prose-sm max-w-none p-6 h-full overflow-y-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
    );
}
